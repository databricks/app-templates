"""Config + registry for non-agent template deploy validation."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

_VALID_VERIFY = {"html", "spa", "mcp", "api", "build", "obo"}
DEFAULT_CONFIG_PATH = Path(__file__).parent / "validation-config.yaml"


@dataclass(frozen=True)
class ValidationTemplate:
    name: str
    verify: str
    # For verify == "html": substrings that MUST appear in the rendered (hydrated)
    # DOM, so a generic 404 / error page / framework shell can't false-pass. The
    # loader requires this to be non-empty for html templates.
    # For verify == "obo": a SUCCESS SIGNAL — text that renders only if the
    # forwarded user token's downstream call succeeded (not the always-rendered
    # header). An obo template with no `expect` is skipped (not yet wired).
    expect: tuple[str, ...] = field(default=())
    # For verify == "obo" only: the accessible name of a control to click after the
    # page loads (e.g. a "Run Query" button) before waiting for `expect` — for apps
    # that run the OBO call on interaction rather than on page load. None = on-load.
    obo_click: str | None = None


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


def _coerce_expect(name: str, verify: str, raw) -> tuple[str, ...]:
    """Normalize the optional `expect` entry to a tuple of non-empty strings."""
    if raw is None:
        expect: tuple[str, ...] = ()
    elif isinstance(raw, str):
        expect = (raw,)
    elif isinstance(raw, (list, tuple)):
        expect = tuple(str(s) for s in raw)
    else:
        raise AssertionError(f"{name}: `expect` must be a string or list, got {type(raw).__name__}")
    assert all(s.strip() for s in expect), f"{name}: `expect` contains an empty string"
    # An html template with no expected content would fall back to the weak
    # "<html> + length" check — exactly the false-pass this guards against.
    if verify == "html":
        assert expect, (
            f"{name}: verify: html requires a non-empty `expect` (a substring the app "
            "renders) so a generic shell/error page can't false-pass"
        )
    return expect


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
        expect = _coerce_expect(name, verify, entry.get("expect"))
        obo_click = entry.get("obo_click")
        assert obo_click is None or verify == "obo", (
            f"{name}: obo_click is only valid for verify: obo"
        )
        templates.append(
            ValidationTemplate(name=name, verify=verify, expect=expect, obo_click=obo_click)
        )

    root = data.get("workspace_source_root") or ""
    if not root and resolve_workspace_root:
        root = derive_workspace_source_root(profile)

    return ValidationConfig(
        profile=profile,
        shared_app_name=data["shared_app_name"],
        workspace_source_root=root,
        templates=templates,
    )
