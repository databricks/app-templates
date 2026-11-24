"""Pydantic models at the trust boundary: invocation input, titles, stops, feedback."""

from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    Field,
    StrictBool,
    StringConstraints,
    field_validator,
    model_validator,
)

from agent.models import DEFAULT_EFFORT, Effort

MESSAGE_CONTENT_CAP = 4000
TITLE_MAX_LENGTH = 120
CONVERSATION_ID_MAX_LENGTH = 64
MODEL_ID_MAX_LENGTH = 64
FEEDBACK_COMMENT_MAX_LENGTH = 2000
MAX_IMAGES = 3
IMAGE_URL_CAP = 2_000_000
IMAGE_TYPES = ("image/png", "image/jpeg", "image/gif", "image/webp")
PARTS_ERROR = (
    "input.messages[0].content must hold at least one part, each input_text, or "
    "input_image with a base64 PNG, JPEG, GIF or WebP data URL of at most "
    "2,000,000 characters."
)


def _is_image_data_url(url: Any) -> bool:
    return (
        isinstance(url, str)
        and len(url) <= IMAGE_URL_CAP
        and any(url.startswith(f"data:{kind};base64,") for kind in IMAGE_TYPES)
    )


def _text_of_parts(parts: list) -> str:
    """Extract text from parts after validation; parts are text or inline data URLs."""
    if not parts:
        raise ValueError(PARTS_ERROR)
    texts: list[str] = []
    images = 0
    for part in parts:
        if not isinstance(part, dict):
            raise ValueError(PARTS_ERROR)
        if set(part) == {"type", "text"} and part["type"] == "input_text":
            if not isinstance(part["text"], str):
                raise ValueError(PARTS_ERROR)
            texts.append(part["text"])
        elif set(part) == {"type", "image_url"} and part["type"] == "input_image":
            if not _is_image_data_url(part["image_url"]):
                raise ValueError(PARTS_ERROR)
            images += 1
        else:
            raise ValueError(PARTS_ERROR)
    if images > MAX_IMAGES:
        raise ValueError(f"input.messages[0] must carry at most {MAX_IMAGES} images.")
    return "".join(texts)


class InvocationInput(BaseModel):
    """Invocation input: message, confirmation, or compact command."""

    model_config = {"extra": "forbid"}

    messages: list[dict] | None = Field(
        None,
        json_schema_extra={
            "description": "Exactly one message with role='user' and content string"
        },
    )
    confirm: dict | None = None
    command: Literal["compact"] | None = None
    replace: bool = False
    model: Annotated[str, StringConstraints(max_length=MODEL_ID_MAX_LENGTH)] | None = (
        None
    )
    effort: Effort = DEFAULT_EFFORT

    @model_validator(mode="after")
    def confirm_and_command_come_alone(self) -> "InvocationInput":
        if self.confirm is not None and self.model_fields_set & {
            "replace",
            "model",
            "effort",
        }:
            raise ValueError(
                "A confirmation can't replace a turn or name a model or an effort."
            )
        if self.command is not None and self.model_fields_set != {"command"}:
            raise ValueError(
                "A command comes alone, without a message, a confirmation, a "
                "replace, a model or an effort."
            )
        return self

    @property
    def has_images(self) -> bool:
        content = self.messages[0]["content"] if self.messages else ""
        return isinstance(content, list) and any(
            part["type"] == "input_image" for part in content
        )

    @field_validator("messages", mode="before")
    @classmethod
    def validate_messages(cls, v: Any) -> Any:
        if v is None:
            return v
        if not isinstance(v, list):
            raise ValueError(
                "input.messages must be a non-empty list of chat messages."
            )
        if len(v) == 0:
            raise ValueError(
                "input.messages must be a non-empty list of chat messages."
            )
        if len(v) != 1:
            raise ValueError("input.messages must contain exactly one user message.")
        msg = v[0]
        if not isinstance(msg, dict):
            raise ValueError("input.messages must contain exactly one user message.")
        if set(msg.keys()) != {"role", "content"}:
            raise ValueError("input.messages must contain exactly one user message.")
        if msg.get("role") != "user":
            raise ValueError("input.messages must contain exactly one user message.")
        content = msg.get("content")
        if isinstance(content, list):
            content = _text_of_parts(content)
        if not isinstance(content, str):
            raise ValueError("input.messages must contain exactly one user message.")
        if len(content) > MESSAGE_CONTENT_CAP:
            msg = (
                f"input.messages[0].content must not exceed "
                f"{MESSAGE_CONTENT_CAP} characters"
            )
            raise ValueError(msg)
        return v

    @field_validator("confirm", mode="before")
    @classmethod
    def validate_confirm(cls, v: Any) -> Any:
        if v is None:
            return v
        if not isinstance(v, dict):
            raise ValueError("confirm must be an object with proposal_id and decision.")
        if set(v.keys()) != {"proposal_id", "decision"}:
            raise ValueError("confirm must be an object with proposal_id and decision.")
        proposal_id = v.get("proposal_id")
        try:
            UUID(str(proposal_id))
        except (ValueError, TypeError):
            raise ValueError("proposal_id must be a valid UUID.")
        if v.get("decision") not in ("approve", "reject"):
            raise ValueError("decision must be 'approve' or 'reject'.")
        return v


Title = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=TITLE_MAX_LENGTH),
]


class ConversationTitle(BaseModel):
    title: Title


class StopRequest(BaseModel):
    session_id: Annotated[
        str, StringConstraints(min_length=1, max_length=CONVERSATION_ID_MAX_LENGTH)
    ]


class FeedbackRequest(BaseModel):
    """A rating of one run: never its trace or its source, which the server finds."""

    model_config = {"extra": "forbid"}

    conversation_id: Annotated[
        str, StringConstraints(min_length=1, max_length=CONVERSATION_ID_MAX_LENGTH)
    ]
    run_id: Annotated[
        str, StringConstraints(min_length=1, max_length=CONVERSATION_ID_MAX_LENGTH)
    ]
    helpful: StrictBool
    comment: Annotated[
        str,
        StringConstraints(
            strip_whitespace=True, max_length=FEEDBACK_COMMENT_MAX_LENGTH
        ),
    ] = ""
