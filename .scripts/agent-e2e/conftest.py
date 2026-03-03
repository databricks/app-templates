import pytest

from template_config import (
    DEFAULT_GENIE_SPACE_ID,
    DEFAULT_KNOWLEDGE_ASSISTANT_ENDPOINT,
    DEFAULT_LAKEBASE,
    DEFAULT_PROFILE,
    DEFAULT_SERVING_ENDPOINT,
    REPO_ROOT,
)


def pytest_addoption(parser):
    parser.addoption("--profile", default=DEFAULT_PROFILE, help="Databricks CLI profile")
    parser.addoption("--lakebase", default=DEFAULT_LAKEBASE, help="Lakebase instance name")
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
        "--knowledge-assistant-endpoint",
        default=DEFAULT_KNOWLEDGE_ASSISTANT_ENDPOINT,
        help="Knowledge assistant endpoint for multiagent template",
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
        help="Skip bundle destroy on failure (keep app running for inspection)",
    )


@pytest.fixture
def profile(request):
    return request.config.getoption("--profile")


@pytest.fixture
def lakebase(request):
    return request.config.getoption("--lakebase")


@pytest.fixture
def repo_root():
    return REPO_ROOT
