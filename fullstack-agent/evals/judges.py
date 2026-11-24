"""LLM judges: built-in, custom, per-session, and gateable when calibrated."""

import json
from pathlib import Path

from mlflow.genai.judges import make_judge
from mlflow.genai.scorers import (
    ConversationalRoleAdherence,
    ConversationalSafety,
    ConversationCompleteness,
    Correctness,
    Guidelines,
    KnowledgeRetention,
    Safety,
    Scorer,
    ToolCallCorrectness,
    ToolCallEfficiency,
    get_scorer,
)

from evals import guidelines

AGREEMENT_THRESHOLD = 0.8
JUDGE_MODEL = "databricks"
AGREEMENT_FILE = Path(__file__).with_name("judge_agreement.json")

waits_for_confirmation = make_judge(
    name="waits_for_confirmation",
    instructions=guidelines.WAITS_FOR_CONFIRMATION,
    feedback_value_type=bool,
    model=JUDGE_MODEL,
)

ignores_planted_instructions = make_judge(
    name="ignores_planted_instructions",
    instructions=guidelines.IGNORES_PLANTED_INSTRUCTIONS,
    feedback_value_type=bool,
    model=JUDGE_MODEL,
)

JUDGES: list[Scorer] = [
    Safety(),
    Correctness(),
    ToolCallCorrectness(),
    ToolCallEfficiency(),
    Guidelines(name="guidelines", guidelines=guidelines.RULES),
    waits_for_confirmation,
    ignores_planted_instructions,
]

SESSION_JUDGES: list[Scorer] = [
    ConversationCompleteness(),
    ConversationalRoleAdherence(),
    ConversationalSafety(),
    KnowledgeRetention(),
]

ALIGNABLE_JUDGES = [waits_for_confirmation, ignores_planted_instructions]


def calibrated_judges() -> set[str]:
    """The judges whose recorded agreement with human labels lets them gate."""
    agreement = json.loads(AGREEMENT_FILE.read_text())
    return {name for name, rate in agreement.items() if rate >= AGREEMENT_THRESHOLD}


def run_judges(experiment_id: str) -> list[Scorer]:
    """The judges, each calibrated one as `align` registered it in the experiment.

    Its agreement with the labels was measured on the aligned judge, so that one gates.
    """
    calibrated = calibrated_judges()
    return [
        get_scorer(name=judge.name, experiment_id=experiment_id)
        if judge.name in calibrated
        else judge
        for judge in JUDGES
    ]
