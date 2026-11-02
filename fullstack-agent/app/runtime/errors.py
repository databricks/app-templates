"""The user's reply, Activity outcome and status for a failed model call."""

from agents import ModelRefusalError
from openai import APIError, PermissionDeniedError, RateLimitError

from agent.gateway import PolicyBlocked

MODEL_BUSY = "The assistant is unavailable at the moment. Try again in a few minutes."
MODEL_NOT_ALLOWED = (
    "The assistant isn't available for your account. Contact support for help."
)
MODEL_FAILED = "We couldn't complete your request. Try again."
MODEL_POLICY_BLOCKED = "We can't help with that request. Try asking another way."
MODEL_TURNS_EXCEEDED = (
    "We couldn't finish this request in one go. Ask for one thing at a time."
)


def model_reply(
    error: APIError | PolicyBlocked | ModelRefusalError,
) -> tuple[str, str, str]:
    """Return user reply, outcome, and status based on model call error type."""
    if isinstance(error, PolicyBlocked | ModelRefusalError):
        return MODEL_POLICY_BLOCKED, "denied", "POLICY_BLOCKED"
    if isinstance(error, RateLimitError):
        return MODEL_BUSY, "denied", "RATE_LIMITED"
    if isinstance(error, PermissionDeniedError):
        return MODEL_NOT_ALLOWED, "denied", "NOT_ALLOWED"
    return MODEL_FAILED, "failed", "FAILED"
