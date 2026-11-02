"""Labeling sessions for the custom judges, and their alignment to the labels."""

import argparse
import json

import mlflow
from mlflow.genai.label_schemas import InputCategorical, create_label_schema
from mlflow.genai.labeling import create_labeling_session, get_labeling_session

from evals import judges
from evals.scorers import is_yes
from evals.workspace import Workspace, token_for, use_runner_identity


def label(arguments: argparse.Namespace) -> int:
    """Create labeling session for custom judges from a run's traces."""
    workspace = Workspace()
    use_runner_identity(workspace, token_for("eval"))
    mlflow.set_experiment(workspace.experiment)
    traces = mlflow.search_traces(run_id=arguments.run_id, return_type="list")
    for judge in judges.ALIGNABLE_JUDGES:
        create_label_schema(
            judge.name,
            type="feedback",
            title=judge.name.replace("_", " ").capitalize(),
            input=InputCategorical(options=["yes", "no"]),
            instruction=judge.instructions,
            overwrite=True,
        )
    session = create_labeling_session(
        name=f"judge-labels-{arguments.run_id[:8]}",
        assigned_users=[arguments.labeler],
        label_schemas=[judge.name for judge in judges.ALIGNABLE_JUDGES],
    )
    session.add_traces(traces)
    print(f"Labeling session {session.mlflow_run_id}: {session.url}")
    return 0


def align(arguments: argparse.Namespace) -> int:
    """Align judges to labels and record agreement for gating."""
    workspace = Workspace()
    use_runner_identity(workspace, token_for("eval"))
    experiment = mlflow.set_experiment(workspace.experiment)
    session = get_labeling_session(arguments.session)
    traces = mlflow.search_traces(run_id=session.mlflow_run_id, return_type="list")
    agreement = json.loads(judges.AGREEMENT_FILE.read_text())
    for judge in judges.ALIGNABLE_JUDGES:
        labeled = [
            trace
            for trace in traces
            if any(
                assessment.name == judge.name
                and assessment.source.source_type == "HUMAN"
                for assessment in trace.info.assessments
            )
        ]
        if not labeled:
            print(f"{judge.name}: no human labels yet")
            continue
        aligned = judge.align(traces=labeled)
        aligned.register(name=judge.name, experiment_id=experiment.experiment_id)
        matches = [
            is_yes(aligned(trace=trace).value)
            == is_yes(
                next(
                    assessment.value
                    for assessment in trace.info.assessments
                    if assessment.name == judge.name
                    and assessment.source.source_type == "HUMAN"
                )
            )
            for trace in labeled
        ]
        agreement[judge.name] = round(sum(matches) / len(matches), 3)
        print(f"{judge.name}: {agreement[judge.name]} on {len(labeled)} labels")
    judges.AGREEMENT_FILE.write_text(json.dumps(agreement, indent=2) + "\n")
    return 0
