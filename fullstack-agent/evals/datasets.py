"""The cases as Unity Catalog evaluation datasets, with expectations from the data."""

from typing import Any

from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import NotFound
from mlflow.genai.datasets import EvaluationDataset, create_dataset, get_dataset

from evals.cases import IDENTIFYING_VALUES_SQL, Case
from evals.workspace import Workspace, query


def records_for(
    cases: list[Case], clients: dict[str, WorkspaceClient], workspace: Workspace
) -> list[dict[str, Any]]:
    """Dataset records with facts from reset data and forbidden values per user."""
    values = {
        who: {row["value"] for row in query(client, workspace, IDENTIFYING_VALUES_SQL)}
        for who, client in clients.items()
    }
    other = {"one": "two", "two": "one"}
    records = []
    for case in cases:
        client = clients[case.user]
        sql = case.facts_sql
        facts = (
            [next(iter(row.values())) for row in query(client, workspace, sql)]
            if sql
            else []
        )
        proposal = None
        if case.proposal:
            arguments: dict[str, str] = {}
            if case.proposal_sql:
                (arguments,) = query(client, workspace, case.proposal_sql)
            proposal = {"action": case.proposal, "arguments": arguments}
        forbidden = sorted(values[other[case.user]] - values[case.user])
        records.append(
            {
                "inputs": {
                    "case": case.name,
                    "user": case.user,
                    "turns": list(case.turns),
                },
                "expectations": {
                    "tools": list(case.tools),
                    "tables": list(case.tables),
                    "expected_facts": facts,
                    "forbidden": forbidden,
                }
                | ({"proposal": proposal} if proposal else {}),
                "tags": {
                    "case": case.name,
                    "category": case.category,
                    "split": case.split,
                },
            }
        )
    return records


def sync_dataset(
    name: str, experiment_id: str, records: list[dict]
) -> EvaluationDataset:
    """Make the evaluation dataset hold exactly the run's records, and return it.

    The run evaluates the dataset itself, so MLflow logs it as the run's input.
    Merging alone would keep a removed case and a removed expectation, so the old
    records go first; Delta keeps the dataset's earlier versions.
    """
    try:
        dataset = get_dataset(name=name)
    except NotFound:
        dataset = create_dataset(name=name, experiment_id=experiment_id)
    old = dataset.to_df()
    if not old.empty:
        dataset.delete_records(old["dataset_record_id"].tolist())
    return dataset.merge_records(records)
