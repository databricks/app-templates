import pytest

from template_config import (
    DEFAULT_GENIE_SPACE_ID,
    DEFAULT_LAKEBASE,
    DEFAULT_LAKEBASE_BRANCH,
    DEFAULT_LAKEBASE_PROJECT,
    DEFAULT_PROFILE,
    DEFAULT_SERVING_ENDPOINT,
    REPO_ROOT,
)


def pytest_addoption(parser):
    parser.addoption("--profile", default=DEFAULT_PROFILE, help="Databricks CLI profile")
    parser.addoption(
        "--lakebase-provisioned-name",
        default=DEFAULT_LAKEBASE,
        help="Lakebase provisioned instance name",
    )
    parser.addoption(
        "--lakebase-autoscaling-project",
        default=DEFAULT_LAKEBASE_PROJECT,
        help="Lakebase autoscaling project name",
    )
    parser.addoption(
        "--lakebase-autoscaling-branch",
        default=DEFAULT_LAKEBASE_BRANCH,
        help="Lakebase autoscaling branch name",
    )
    parser.addoption("--template", action="append", default=None, help="Run only these templates (repeatable)")
    parser.addoption(
        "--genie-space-id",
        default=DEFAULT_GENIE_SPACE_ID,
        help="Genie space ID for multiagent template",
    )
    parser.addoption(
        "--serving-endpoint",
        default=DEFAULT_SERVING_ENDPOINT,
        help="Serving endpoint name for multiagent template",
    )
    parser.addoption(
        "--skip-local", action="store_true", default=False, help="Skip local testing"
    )
    parser.addoption(
        "--skip-deploy", action="store_true", default=False, help="Skip deploy testing"
    )
    parser.addoption(
        "--no-destroy",
        action="store_true",
        default=False,
        help="Skip bundle destroy (keep app running for inspection)",
    )
    # Quickstart e2e test options
    parser.addoption(
        "--quickstart-only",
        action="store_true",
        default=False,
        help="Skip deploy phase in quickstart e2e tests (only validate quickstart output)",
    )
    parser.addoption(
        "--git-ref",
        default=None,
        help="Test quickstart against a specific git ref (branch/commit) instead of working tree",
    )
    parser.addoption(
        "--scenario",
        action="append",
        default=None,
        help="Run only specific quickstart e2e scenarios (repeatable): fresh-and-idempotent, existing-app, lakebase-idempotent",
    )


@pytest.fixture
def profile(request):
    return request.config.getoption("--profile")


@pytest.fixture
def lakebase_provisioned_name(request):
    return request.config.getoption("--lakebase-provisioned-name")


@pytest.fixture
def lakebase_project(request):
    return request.config.getoption("--lakebase-autoscaling-project")


@pytest.fixture
def lakebase_branch(request):
    return request.config.getoption("--lakebase-autoscaling-branch")


@pytest.fixture
def repo_root():
    return REPO_ROOT
