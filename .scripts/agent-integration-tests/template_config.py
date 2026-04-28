import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------------------
# Configurable defaults — override via pytest CLI options
# Workspace: https://db-ml-models-dev-us-west.cloud.databricks.com
# ---------------------------------------------------------------------------
DEFAULT_PROFILE = "dev"
DEFAULT_LAKEBASE = "bbqiu"
DEFAULT_LAKEBASE_AUTOSCALING_ENDPOINT = "projects/bryan-agent-integ-tests/branches/production/endpoints/primary"
DEFAULT_GENIE_SPACE_ID = "01f05202dbb51d74b6cccf1b1b1683eb"
DEFAULT_SERVING_ENDPOINT = "agents_dev-bbqiu-test-bb-2-25"
# Default target for the multiagent template's <YOUR-TARGET-APP-NAME>
# app-to-app CAN_USE permission. Empty means "strip the block" —
# local users don't need to set up app-to-app to run the test. CI
# sets this to a persistent app in the workspace to exercise the
# feature end-to-end.
DEFAULT_TARGET_APP_NAME = ""


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------
@dataclass
class FileEdit:
    """A file edit to apply/revert."""

    relative_path: str  # e.g. "databricks.yml" or "agent_server/agent.py"
    old: str  # text to find
    new: str  # text to replace with


@dataclass
class TemplateConfig:
    name: str  # e.g. "agent-langgraph"
    dev_app_name: str  # e.g. "dev-agent-langgraph"
    app_resource_key: str  # DAB resource key under resources.apps
    is_conversational: bool = True  # /responses vs /invocations
    needs_lakebase: bool = False  # Whether template uses lakebase
    lakebase_type: str = ""  # "provisioned", "autoscaling", or ""
    is_advanced: bool = False  # Whether this is an advanced template (has session + long-term memory)
    pre_test_edits: list[FileEdit] = field(default_factory=list)
    has_evaluate: bool = True
    validate_time: bool = True  # Whether to validate get_current_time tool output


# ---------------------------------------------------------------------------
# Multiagent SUBAGENTS
# ---------------------------------------------------------------------------


def _multiagent_subagents_new(
    genie_space_id: str, serving_endpoint: str
) -> str:
    return f"""\
SUBAGENTS = [
    {{
        "name": "genie",
        "type": "genie",
        "space_id": "{genie_space_id}",
        "description": (
            "Query a Genie space for structured data analysis. "
            "Use this for questions about data, metrics, and tables."
        ),
    }},
    {{
        "name": "serving_endpoint",
        "type": "serving_endpoint",
        "endpoint": "{serving_endpoint}",
        "description": (
            "Query a model hosted on a Databricks Model Serving endpoint. "
            "Use this for questions best answered by the serving model. "
            "The endpoint must have task type agent/v1/responses."
        ),
    }},
]"""


def _multiagent_edits(
    template_name: str,
    genie_space_id: str,
    serving_endpoint: str,
    target_app_name: str,
) -> list[FileEdit]:
    """Build pre_test_edits for multiagent, skipping already-configured values."""
    template_dir = REPO_ROOT / template_name
    edits: list[FileEdit] = []

    # Match the SUBAGENTS = [...] block and replace if it still has commented-out code
    agent_py = (template_dir / "agent_server" / "agent.py").read_text()
    match = re.search(r"SUBAGENTS\s*=\s*\[.*?\]", agent_py, re.DOTALL)
    if match and "#" in match.group(0):
        edits.append(
            FileEdit(
                relative_path="agent_server/agent.py",
                old=match.group(0),
                new=_multiagent_subagents_new(genie_space_id, serving_endpoint),
            )
        )

    # Only replace databricks.yml placeholders if they exist
    yml_text = (template_dir / "databricks.yml").read_text()
    for old, new in [
        ("<YOUR-GENIE-SPACE-ID>", genie_space_id),
        ("<YOUR-SERVING-ENDPOINT>", serving_endpoint),
        ("<YOUR-KNOWLEDGE-ASSISTANT-ENDPOINT>", serving_endpoint),
    ]:
        if old in yml_text:
            edits.append(FileEdit(relative_path="databricks.yml", old=old, new=new))

    # Handle the `agent_app` permission entry that grants this app CAN_USE
    # on another app. Two modes:
    #   * target_app_name set: substitute the placeholder (exercises the
    #     app-to-app CAN_USE feature). Target app must already exist in
    #     the workspace, so use a persistent one — not a sibling template
    #     that may or may not be deployed at the time this runs.
    #   * target_app_name empty: strip the whole block so local tests
    #     succeed without requiring any app-to-app setup.
    agent_app_block = (
        "\n        # TODO: Set the target app name to grant CAN_USE access.\n"
        "        # Requires CLI v0.298.0+ for native app-to-app bundle resource support.\n"
        "        - name: 'agent_app'\n"
        "          app:\n"
        "            name: '<YOUR-TARGET-APP-NAME>'\n"
        "            permission: 'CAN_USE'\n"
    )
    if target_app_name:
        if "<YOUR-TARGET-APP-NAME>" in yml_text:
            edits.append(
                FileEdit(
                    relative_path="databricks.yml",
                    old="<YOUR-TARGET-APP-NAME>",
                    new=target_app_name,
                )
            )
    elif agent_app_block in yml_text:
        edits.append(FileEdit(relative_path="databricks.yml", old=agent_app_block, new=""))

    return edits


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parents[2]


def _parse_databricks_yml(template_name: str) -> tuple[str, str]:
    """Parse dev_app_name and app_resource_key from databricks.yml.

    Returns (dev_app_name, app_resource_key) where dev_app_name
    has ${bundle.target} resolved to 'dev'.
    """
    yml_path = REPO_ROOT / template_name / "databricks.yml"
    text = yml_path.read_text()

    app_match = re.search(
        r'^\s*apps:\s*\n\s*(\w+):\s*\n\s*name:\s*"([^"]+)"', text, re.MULTILINE
    )
    assert app_match, f"Could not find app name in {yml_path}"
    app_resource_key = app_match.group(1)
    dev_app_name = app_match.group(2).replace("${bundle.target}", "dev")

    assert len(dev_app_name) <= 30, (
        f"App name '{dev_app_name}' is {len(dev_app_name)} chars (max 30) "
        f"in {yml_path}"
    )
    return dev_app_name, app_resource_key


# ---------------------------------------------------------------------------
# Template builder
# ---------------------------------------------------------------------------
def _neutralize_memory_schema_env_edits(template_name: str) -> list[FileEdit]:
    """Override the hardcoded LAKEBASE_AGENT_MEMORY_SCHEMA env to `public`.

    The advanced templates ship with `LAKEBASE_AGENT_MEMORY_SCHEMA: <schema>`
    set in databricks.yml's app config. The bridge LakebaseClient reads
    that env, then runs `SET search_path TO <schema>, public` on every
    session — putting the template-specific schema first. Without
    schema-qualified CREATE TABLE in langgraph's checkpoint setup, that
    routes new tables into a schema the per-test SP doesn't own +
    can't write to (the schema is owned by another SP and tables in it
    inherit that ownership).

    Override to `public` for tests: the SP has CREATE on public via
    `_MANAGED_SCHEMAS`, langgraph creates fresh tables there, the SP
    owns them. (Empty value fails Databricks Apps' env-var validation:
    `Must specify environment variable source using either value or
    valueFrom`. Using a non-empty schema avoids that.)

    Reverted in the finally block as part of `revert_edits`.
    """
    template_dir = REPO_ROOT / template_name
    yml = (template_dir / "databricks.yml").read_text()
    edits: list[FileEdit] = []
    for old_value in ('"agent_langgraph_memory"', '"agent_openai_memory"'):
        marker = f'- name: LAKEBASE_AGENT_MEMORY_SCHEMA\n            value: {old_value}'
        if marker in yml:
            edits.append(
                FileEdit(
                    relative_path="databricks.yml",
                    old=marker,
                    new=f'- name: LAKEBASE_AGENT_MEMORY_SCHEMA\n            value: "public"',
                )
            )
            break
    return edits


def build_templates(
    genie_space_id: str = DEFAULT_GENIE_SPACE_ID,
    serving_endpoint: str = DEFAULT_SERVING_ENDPOINT,
    target_app_name: str = DEFAULT_TARGET_APP_NAME,
) -> list[TemplateConfig]:
    # (name, needs_lakebase, overrides)
    configs: list[tuple[str, bool, dict]] = [
        ("agent-langgraph", False, {}),
        ("agent-langgraph-advanced", True, {
            "is_advanced": True,
            "pre_test_edits": _neutralize_memory_schema_env_edits("agent-langgraph-advanced"),
        }),
        ("agent-openai-agents-sdk", False, {}),
        ("agent-openai-advanced", True, {
            "is_advanced": True,
            "pre_test_edits": _neutralize_memory_schema_env_edits("agent-openai-advanced"),
        }),
        (
            "agent-openai-agents-sdk-multiagent",
            False,
            {
                "pre_test_edits": _multiagent_edits(
                    "agent-openai-agents-sdk-multiagent",
                    genie_space_id,
                    serving_endpoint,
                    target_app_name,
                ),
                "validate_time": False,
            },
        ),
        ("agent-non-conversational", False, {"is_conversational": False, "has_evaluate": False}),
        ("agent-migration-from-model-serving", False, {}),
    ]

    # Templates to skip in tests (still listed above for registry validation)
    skip_templates = {"agent-migration-from-model-serving"}

    # Validate that all templates from the canonical registry are covered
    sys.path.insert(0, str(REPO_ROOT / ".scripts"))
    from templates import TEMPLATES as CANONICAL_TEMPLATES

    config_names = {name for name, _, _ in configs}
    canonical_names = set(CANONICAL_TEMPLATES.keys())
    missing = canonical_names - config_names
    if missing:
        raise ValueError(
            f"Templates in .scripts/templates.py but not in template_config.py: {missing}. "
            "Add them to the configs list or explicitly exclude them."
        )

    templates = []
    for name, needs_lakebase, overrides in configs:
        if name in skip_templates:
            continue
        dev_app_name, app_resource_key = _parse_databricks_yml(name)
        if needs_lakebase:
            for lb_type in ("provisioned", "autoscaling"):
                templates.append(
                    TemplateConfig(
                        name=name,
                        dev_app_name=dev_app_name,
                        app_resource_key=app_resource_key,
                        needs_lakebase=True,
                        lakebase_type=lb_type,
                        **overrides,
                    )
                )
        else:
            templates.append(
                TemplateConfig(
                    name=name,
                    dev_app_name=dev_app_name,
                    app_resource_key=app_resource_key,
                    **overrides,
                )
            )
    return templates
