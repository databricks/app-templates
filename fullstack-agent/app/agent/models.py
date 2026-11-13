"""The models a user may choose for a run, configured in `models.toml`."""

import tomllib
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Literal, get_args

MODELS_FILE = Path(__file__).parent / "models.toml"

Reasoning = Literal["between_tools", "adaptive"]
Effort = Literal["low", "medium", "high"]
DEFAULT_EFFORT: Effort = "low"


@dataclass(frozen=True)
class Model:
    """Unity Gateway model service configured in models.toml."""

    id: str
    name: str
    images: bool
    reasoning: Reasoning
    context_window: int


@cache
def allowed_models() -> tuple[Model, ...]:
    """Load models from models.toml, validate reasoning, cache result."""
    with MODELS_FILE.open("rb") as file:
        models = tuple(Model(**entry) for entry in tomllib.load(file)["models"])
    for model in models:
        if model.reasoning not in get_args(Reasoning):
            allowed = ", ".join(get_args(Reasoning))
            raise ValueError(
                f"{MODELS_FILE.name}: model {model.id!r} has reasoning "
                f"{model.reasoning!r}. Set it to one of: {allowed}."
            )
    return models


def model_named(model_id: str | None) -> Model:
    """Return the allowed model, or default if model_id is None."""
    models = allowed_models()
    if model_id is None:
        return models[0]
    for model in models:
        if model.id == model_id:
            return model
    allowed = ", ".join(model.id for model in models)
    raise ValueError(f"model {model_id!r} is not allowed. Use one of: {allowed}.")
