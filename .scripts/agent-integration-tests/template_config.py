import ast
import re
import sys
from dataclasses import dataclass, field, replace
from pathlib import Path

# ---------------------------------------------------------------------------
# Configurable defaults — override via pytest CLI options
# Workspace: https://db-ml-models-dev-us-west.cloud.databricks.com
# ---------------------------------------------------------------------------
DEFAULT_PROFILE = "dev"
DEFAULT_LAKEBASE_AUTOSCALING_ENDPOINT = "projects/bryan-agent-integ-tests/branches/production/endpoints/primary"
DEFAULT_GENIE_SPACE_ID = "01f05202dbb51d74b6cccf1b1b1683eb"
DEFAULT_SERVING_ENDPOINT = "agents_dev-bbqiu-test-bb-2-25"
# Default target for the multiagent template's <YOUR-TARGET-APP-NAME>
# app-to-app CAN_USE permission. Empty means "strip the block" —
# local users don't need to set up app-to-app to run the test. CI
# sets this to a persistent app in the workspace to exercise the
# feature end-to-end.
DEFAULT_TARGET_APP_NAME = ""
DEFAULT_MLFLOW_UC_CATALOG = "main"
DEFAULT_MLFLOW_UC_SCHEMA = "agent_traces"
DEFAULT_MLFLOW_UC_TABLE_PREFIX = "agents_on_apps"
DEFAULT_MLFLOW_OTEL_SPANS_TABLE = (
    "main.agent_traces.agents_on_apps_otel_spans"
)


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
    lakebase_type: str = ""  # "autoscaling" or ""
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
def build_templates(
    genie_space_id: str = DEFAULT_GENIE_SPACE_ID,
    serving_endpoint: str = DEFAULT_SERVING_ENDPOINT,
    target_app_name: str = DEFAULT_TARGET_APP_NAME,
) -> list[TemplateConfig]:
    policy_templates = build_trace_policy_templates()
    configs: list[tuple[str, bool, dict]] = []
    for policy in policy_templates:
        # The Python E2E runner requires the MLflow AgentServer layout. Other
        # discovered surfaces (currently standalone TypeScript) retain their
        # own documented local/deployed commands and stay in the policy gate.
        if not (policy.path / "agent_server" / "start_server.py").exists():
            continue
        if policy.name == "agent-migration-from-model-serving":
            # Migration is a reference template without a runnable Apps target.
            continue
        deployment = (policy.path / "databricks.yml").read_text()
        needs_lakebase = bool(re.search(r"\bpostgres:\s*$", deployment, re.MULTILINE))
        overrides: dict = {}
        if "advanced" in policy.name:
            overrides["is_advanced"] = True
        if "multiagent" in policy.name:
            overrides.update(
                {
                    "pre_test_edits": _multiagent_edits(
                        policy.name,
                        genie_space_id,
                        serving_endpoint,
                        target_app_name,
                    ),
                    "validate_time": False,
                }
            )
        if "non-conversational" in policy.name:
            overrides.update({"is_conversational": False, "has_evaluate": False})
        configs.append((policy.name, needs_lakebase, overrides))

    templates = []
    for name, needs_lakebase, overrides in configs:
        dev_app_name, app_resource_key = _parse_databricks_yml(name)
        if needs_lakebase:
            templates.append(
                TemplateConfig(
                    name=name,
                    dev_app_name=dev_app_name,
                    app_resource_key=app_resource_key,
                    needs_lakebase=True,
                    lakebase_type="autoscaling",
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


def build_trace_policy_templates():
    """Discover primary agent templates and attach shared deployed proof.

    Candidate selection is a repository convention plus source behavior, not a
    hand-maintained list: any new ``agent-*`` directory detected by the shared
    discovery engine enters this gate automatically.
    """
    conformance_dir = REPO_ROOT / ".scripts" / "trace-conformance"
    sys.path.insert(0, str(conformance_dir))
    from discovery import discover_agentic_templates

    deployed_harness = (
        REPO_ROOT
        / ".scripts"
        / "agent-integration-tests"
        / "test_quickstart_e2e.py"
    ).read_text()
    tree = ast.parse(deployed_harness)
    imported = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom)
        for alias in node.names
    }
    called = {
        node.func.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    }
    called.update(
        node.func.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    )
    shared_deployed_proof = {
        "assert_trace_contract",
        "execute_trace_row_query",
        "normalize_python_mlflow_trace",
        "normalize_uc_rows",
    }.issubset(imported | called)
    return [
        replace(
            template,
            has_deployed_verification=(
                template.has_deployed_verification or shared_deployed_proof
            ),
        )
        for template in discover_agentic_templates(REPO_ROOT)
        if template.name.startswith("agent-") and template.local_test_command
    ]
