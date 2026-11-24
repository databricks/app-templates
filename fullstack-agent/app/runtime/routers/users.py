"""The signed-in user, and the models a run may use."""

from dataclasses import asdict
from typing import Any

from fastapi import APIRouter

from agent.models import allowed_models
from runtime.auth import SignedIn

router = APIRouter()


@router.get("/me")
def me(caller: SignedIn) -> dict[str, str | None]:
    """Return the signed-in user."""
    user = caller.client_for("user").current_user.me()
    return {
        "email": caller.email,
        "user_name": user.user_name,
        "display_name": user.display_name,
    }


@router.get("/models")
def models(caller: SignedIn) -> list[dict[str, Any]]:
    """Return allowed models, default first, from app configuration."""
    return [asdict(model) for model in allowed_models()]
