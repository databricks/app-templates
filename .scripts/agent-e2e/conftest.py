from pathlib import Path

import pytest

from helpers import kill_port


def pytest_addoption(parser):
    parser.addoption("--profile", default="dev", help="Databricks CLI profile")
    parser.addoption("--lakebase", default="bbqiu", help="Lakebase instance name")
    parser.addoption("--template", default=None, help="Run only this template")
    parser.addoption(
        "--skip-local", action="store_true", default=False, help="Skip local testing"
    )
    parser.addoption(
        "--skip-deploy", action="store_true", default=False, help="Skip deploy testing"
    )


@pytest.fixture
def profile(request):
    return request.config.getoption("--profile")


@pytest.fixture
def lakebase(request):
    return request.config.getoption("--lakebase")


@pytest.fixture
def repo_root():
    return Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True)
def cleanup_port():
    """Ensure port 8000 is free after each test."""
    yield
    kill_port(8000)


def pytest_collection_modifyitems(config, items):
    """Filter tests by --template option (exact match on parametrize id)."""
    template_filter = config.getoption("--template")
    if template_filter:
        items[:] = [
            item for item in items if f"[{template_filter}]" in item.nodeid
        ]
