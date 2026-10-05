"""Config + registry for non-agent template deploy validation."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml

_VALID_VERIFY = {"html", "spa", "mcp", "api", "build"}
DEFAULT_CONFIG_PATH = Path(__file__).parent / "validation-config.yaml"


@dataclass(frozen=True)
class ValidationTemplate:
    name: str
    verify: str


@dataclass(frozen=True)
class ValidationConfig:
    profile: str
    shared_app_name: str
    workspace_source_root: str
    templates: list[ValidationTemplate]


def derive_workspace_source_root(profile: str) -> str:
    from databricks.sdk import WorkspaceClient

    user = WorkspaceClient(profile=profile).current_user.me().user_name
    return f"/Workspace/Users/{user}/template-validation"


def load_validation_config(
    path: Path = DEFAULT_CONFIG_PATH,
    *,
    resolve_workspace_root: bool = True,
) -> ValidationConfig:
    data = yaml.safe_load(path.read_text())
    profile = data["profile"]
    templates = []
    for name, entry in data["templates"].items():
        verify = entry["verify"]
        assert verify in _VALID_VERIFY, f"{name}: bad verify kind {verify!r}"
        templates.append(ValidationTemplate(name=name, verify=verify))

    root = data.get("workspace_source_root") or ""
    if not root and resolve_workspace_root:
        root = derive_workspace_source_root(profile)

    return ValidationConfig(
        profile=profile,
        shared_app_name=data["shared_app_name"],
        workspace_source_root=root,
        templates=templates,
    )
