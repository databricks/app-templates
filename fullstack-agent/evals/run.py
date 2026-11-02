"""Run one eval split on the deployed app, gate it, and log it to MLflow."""

import argparse
import json
from collections import defaultdict
from dataclasses import asdict
from typing import Any

import mlflow
import pandas as pd
from databricks.sdk import WorkspaceClient
from mlflow import MlflowClient
from mlflow.genai.simulators import ConversationSimulator

from agent.agent import instructions
from evals import gate, judges, scorers
from evals.agent_client import AgentApp
from evals.cases import CASES, SESSIONS, SESSIONS_TO_SIMULATE
from evals.datasets import records_for, sync_dataset
from evals.scorers import is_yes
from evals.workspace import Workspace, git_sha, token_for, use_runner_identity

PROMPT = "assistant_instructions"

PROMPT_ALIAS = "evaluated"

PROMPT_LOCATION_TAG = "mlflow.promptRegistryLocation"

MAX_SESSION_TURNS = 4

SESSION_METADATA = "mlflow.trace.session"


def with_message(outputs: dict[str, Any]) -> dict[str, Any]:
    """Add answer and displays to the judges' message."""
    answer = outputs["answers"][-1] if outputs["answers"] else ""
    shown = [
        answer,
        *(json.dumps(payload, ensure_ascii=False) for payload in outputs["displays"]),
    ]
    message = {"role": "assistant", "content": "\n\n".join(shown)}
    return outputs | {"messages": [message]}


def register_prompt(name: str, sha: str) -> int:
    """Register the agent's instructions when they changed, and return their version.

    Unity Catalog has no `latest` alias, so the evals move their own alias to each
    version they register and compare the instructions with the version it names.
    """
    template = instructions()
    evaluated = mlflow.genai.load_prompt(
        f"prompts:/{name}@{PROMPT_ALIAS}", allow_missing=True
    )
    if evaluated is not None and evaluated.template == template:
        return evaluated.version
    prompt = mlflow.genai.register_prompt(
        name=name,
        template=template,
        commit_message=f"Agent instructions at {sha}",
        tags={"git_sha": sha},
    )
    mlflow.genai.set_prompt_alias(name, alias=PROMPT_ALIAS, version=prompt.version)
    return prompt.version


def show_prompts(workspace: Workspace, experiment_id: str) -> None:
    """Point the eval and trace experiments' Prompts tab at the eval schema.

    On Databricks the tab lists the prompts of the schema this experiment tag names.
    """
    traces = mlflow.get_experiment_by_name(workspace.trace_experiment)
    client = MlflowClient()
    for tagged in (experiment_id, traces.experiment_id):
        client.set_experiment_tag(tagged, PROMPT_LOCATION_TAG, workspace.eval_schema)


def verdicts(row: pd.Series) -> dict[str, Any]:
    """Each scorer's value on one result row; human labels don't count."""
    return {
        assessment["assessment_name"]: (assessment.get("feedback") or {}).get("value")
        for assessment in row["assessments"]
        if assessment["source"]["source_type"] != "HUMAN"
    }


def passed(row: pd.Series, gating: list[str]) -> bool:
    """Whether every gating scorer said yes for one result row."""
    values = verdicts(row)
    return all(is_yes(values.get(name)) for name in gating)


def gating_names(category: str) -> list[str]:
    extra = scorers.CATEGORY_SCORERS.get(category, [])
    return [s.name for s in scorers.CODE_SCORERS + extra] + sorted(
        judges.calibrated_judges()
    )


def release_baseline(experiment_id: str, split: str) -> dict[str, float] | None:
    """The last release run's lower bound per category, or None before a release."""
    runs = mlflow.search_runs(
        experiment_ids=[experiment_id],
        filter_string=f"tags.release = 'true' AND tags.split = '{split}'",
        order_by=["start_time DESC"],
        max_results=1,
        output_format="list",
    )
    if not runs:
        return None
    return {
        name.removesuffix("_low"): value
        for name, value in runs[0].data.metrics.items()
        if name.endswith("_low")
    }


def single_turn_trials(results: pd.DataFrame) -> list[gate.Trial]:
    """One trial per result row, named and grouped by its record's tags."""
    trials = []
    for _, row in results.iterrows():
        category = row["tags"]["category"]
        gating = gating_names(category)
        trials.append(gate.Trial(row["tags"]["case"], category, passed(row, gating)))
    return trials


SESSION_GATING = [
    scorers.no_write_before_confirm,
    scorers.no_ids,
    scorers.no_personal_data,
    scorers.no_instructions_leak,
]


def session_trials(results: pd.DataFrame) -> list[gate.Trial]:
    """One trial per simulated session: it passes when every turn passes."""
    turns: dict[str, list[bool]] = defaultdict(list)
    names = [s.name for s in SESSION_GATING] + sorted(judges.calibrated_judges())
    for _, row in results.iterrows():
        session = row["trace_metadata"][SESSION_METADATA]
        turns[session].append(passed(row, names))
    return [gate.Trial(session, SESSIONS, all(oks)) for session, oks in turns.items()]


def run(arguments: argparse.Namespace) -> int:
    """Run eval split, gate it, and log to MLflow."""
    workspace = Workspace()
    sha = git_sha()
    user_tokens = {"one": token_for("one"), "two": token_for("two")}
    clients = {
        who: WorkspaceClient(host=workspace.host, token=token, auth_type="pat")
        for who, token in user_tokens.items()
    }
    categories = set(arguments.categories or [])
    cases = [
        case
        for case in CASES
        if case.split == arguments.split
        and (not categories or case.category in categories)
    ]
    sessions = [
        session
        for session in SESSIONS_TO_SIMULATE
        if session.split == arguments.split
        and (not categories or SESSIONS in categories)
    ]
    records = records_for(cases, clients, workspace)
    estimate = arguments.k * (len(cases) + MAX_SESSION_TURNS * len(sessions))
    print(
        f"{arguments.k} x {len(cases)} cases and {len(sessions)} sessions: about "
        f"{estimate * arguments.tokens_per_turn:,} agent tokens, capped at "
        f"{arguments.max_tokens:,}."
    )
    use_runner_identity(workspace, token_for("eval"))
    experiment = mlflow.set_experiment(workspace.experiment)
    data = [
        record | {"inputs": record["inputs"] | {"trial": trial}}
        for trial in range(arguments.k)
        for record in records
    ]
    dataset = sync_dataset(
        workspace.table(f"evals_{arguments.split}"), experiment.experiment_id, data
    )
    prompt = workspace.table(PROMPT)
    prompt_version = register_prompt(prompt, sha)
    show_prompts(workspace, experiment.experiment_id)
    app = AgentApp(workspace.app_url, user_tokens, arguments.max_tokens)

    @mlflow.trace
    def predict(case: str, user: str, turns: list[str], trial: int) -> dict:
        return with_message(app.ask(user, turns))

    @mlflow.trace
    def predict_session(input: list[dict], mlflow_session_id: str, user: str) -> dict:
        text = input[-1]["content"]
        return with_message(app.ask_in_session(user, mlflow_session_id, text))

    run_judges = judges.run_judges(experiment.experiment_id)
    gating_judges = [
        judge for judge in run_judges if judge.name in judges.calibrated_judges()
    ]
    single_turn = (
        scorers.CODE_SCORERS
        + [s for extra in scorers.CATEGORY_SCORERS.values() for s in extra]
        + scorers.MEASURES
        + run_judges
    )
    with mlflow.start_run(run_name=f"{arguments.split}-{sha[:8]}") as parent:
        mlflow.genai.load_prompt(f"prompts:/{prompt}/{prompt_version}")
        mlflow.set_tags(
            {
                "git_sha": sha,
                "split": arguments.split,
                "app_deployment": workspace.deployment,
                "model_service": json.dumps(workspace.model_service["config"]),
                "k": str(arguments.k),
                "categories": ",".join(sorted(categories)) or "all",
            }
        )
        trials = []
        if data:
            result = mlflow.genai.evaluate(
                data=dataset, predict_fn=predict, scorers=single_turn
            )
            trials += single_turn_trials(result.result_df)
        if sessions:
            with mlflow.start_run(run_name="sessions", nested=True):
                simulator = ConversationSimulator(
                    test_cases=[
                        {
                            "goal": session.goal,
                            "persona": session.persona,
                            "context": {"user": session.user},
                        }
                        for session in sessions
                        for _ in range(arguments.k)
                    ],
                    max_turns=MAX_SESSION_TURNS,
                )
                result = mlflow.genai.evaluate(
                    data=simulator,
                    predict_fn=predict_session,
                    scorers=SESSION_GATING + judges.SESSION_JUDGES + gating_judges,
                )
                trials += session_trials(result.result_df)
        baseline = release_baseline(experiment.experiment_id, arguments.split)
        results = gate.category_results(trials, baseline)
        capped = app.spent >= app.max_tokens
        for item in results:
            mlflow.log_metrics(
                {
                    f"{item.category}_rate": item.rate,
                    f"{item.category}_low": item.low,
                    f"{item.category}_high": item.high,
                }
            )
            print(
                f"{'PASS' if item.ok else 'FAIL'} {item.category}: {item.passed}/"
                f"{item.total}, {item.rate:.2f} [{item.low:.2f}, {item.high:.2f}] "
                f"{item.reason}"
            )
        mlflow.log_metric("agent_tokens", app.spent)
        mlflow.log_dict([asdict(item) for item in results], "gate.json")
        ok = bool(results) and all(item.ok for item in results) and not capped
        mlflow.set_tag("gate", "pass" if ok else "fail")
        if ok and arguments.release:
            mlflow.set_tag("release", "true")
        print(
            f"Agent tokens: {app.spent:,} of {arguments.max_tokens:,}"
            + (" (cap reached, the run is incomplete)" if capped else "")
        )
        print(f"Gate: {'pass' if ok else 'fail'}. Run {parent.info.run_id}.")
    return 0 if ok else 1
