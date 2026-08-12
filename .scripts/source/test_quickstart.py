# Quickstart script functionality:
# 1. Checks prerequisites (uv, node, npm, databricks CLI) and validates Node.js version
# 2. Creates .env from .env.example (or from scratch)
# 3. Sets up Databricks authentication (validates/creates profile)
# 4. Gets Databricks username via current-user API
# 5. Creates MLflow experiment via `databricks experiments create-experiment`
# 6. Updates .env with: DATABRICKS_CONFIG_PROFILE, MLFLOW_TRACKING_URI, MLFLOW_EXPERIMENT_ID
# 7. Updates databricks.yml: sets experiment_id in app resource
# 8. (If lakebase needed) Sets up autoscaling lakebase
# 9. (If lakebase needed) Updates databricks.yml: sets the autoscaling lakebase env vars and postgres resource
# 10. (If lakebase needed) Updates .env with LAKEBASE_AUTOSCALING_ENDPOINT

import json
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

import pytest
from mlflow.entities.trace_location import UnityCatalog

import quickstart

from quickstart import (
    _replace_lakebase_env_vars,
    _replace_lakebase_resource,
    create_lakebase_instance,
    get_databricks_yml_experiment_id,
    get_existing_lakebase_config,
    setup_env_file,
    setup_lakebase,
    update_databricks_yml_app_name,
    update_databricks_yml_experiment,
    update_databricks_yml_lakebase,
    update_env_file,
    validate_lakebase_config,
)

# A minimal databricks.yml for testing app name updates
MINIMAL_YML_WITH_APP_NAME = """\
bundle:
  name: agent_langgraph

resources:
  apps:
    agent_langgraph:
      name: "agent-langgraph"
      description: "LangGraph agent application"
      source_code_path: ./
      config:
        command: ["uv", "run", "start-app"]
        env:
          - name: MLFLOW_EXPERIMENT_ID
            value_from: "experiment"

      resources:
        - name: 'experiment'
          experiment:
            experiment_id: ""
            permission: 'CAN_MANAGE'

targets:
  dev:
    mode: development
"""

# A minimal databricks.yml with experiment app resource (like agent-langgraph)
MINIMAL_YML = """\
bundle:
  name: agent_langgraph

resources:
  apps:
    agent_langgraph:
      name: "agent-langgraph"
      description: "LangGraph agent application"
      source_code_path: ./
      config:
        command: ["uv", "run", "start-app"]
        env:
          - name: MLFLOW_EXPERIMENT_ID
            value_from: "experiment"

      # Resources which this app has access to
      resources:
        - name: 'experiment'
          experiment:
            experiment_id: ""
            permission: 'CAN_MANAGE'

targets:
  dev:
    mode: development
"""

# A databricks.yml with lakebase env vars (like agent-langgraph-advanced)
LAKEBASE_YML = """\
bundle:
  name: agent_langgraph_advanced

resources:
  apps:
    agent_langgraph_advanced:
      name: "agent-langgraph-advanced"
      description: "LangGraph agent application with short-term and long-term memory"
      source_code_path: ./
      config:
        command: ["uv", "run", "start-app"]
        env:
          - name: MLFLOW_EXPERIMENT_ID
            value_from: "experiment"
          - name: LAKEBASE_AUTOSCALING_ENDPOINT
            value_from: "postgres"

      # Resources which this app has access to
      resources:
        - name: 'experiment'
          experiment:
            experiment_id: ""
            permission: 'CAN_MANAGE'
        # Autoscaling postgres resource
        - name: 'postgres'
          postgres:
            endpoint: "<your-autoscaling-endpoint>"
            permission: 'CAN_CONNECT_AND_CREATE'

targets:
  dev:
    mode: development
"""

# Double-quoted variant (like agent-openai-advanced with double-quoted YAML keys)
DOUBLE_QUOTED_YML = """\
bundle:
  name: agent_openai_advanced

resources:
  apps:
    agent_openai_advanced:
      name: "agent-openai-advanced"
      config:
        env:
          - name: MLFLOW_EXPERIMENT_ID
            value_from: "experiment"
          - name: LAKEBASE_AUTOSCALING_ENDPOINT
            value_from: "postgres"

      # Resources which this app has access to
      resources:
        - name: "experiment"
          experiment:
            experiment_id: ""
            permission: "CAN_MANAGE"
        # Autoscaling postgres resource
        - name: "postgres"
          postgres:
            endpoint: "<your-autoscaling-endpoint>"
            permission: "CAN_CONNECT_AND_CREATE"

targets:
  dev:
    mode: development
"""


@pytest.fixture(autouse=True)
def _chdir(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)


class TestUpdateDatabricksYmlExperiment:
    def test_sets_experiment_id_in_resource(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(MINIMAL_YML)
        update_databricks_yml_experiment("12345")
        content = (tmp_path / "databricks.yml").read_text()
        assert 'experiment_id: "12345"' in content

    def test_preserves_value_from(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(MINIMAL_YML)
        update_databricks_yml_experiment("12345")
        content = (tmp_path / "databricks.yml").read_text()
        assert 'value_from: "experiment"' in content

    def test_preserves_other_content(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(MINIMAL_YML)
        update_databricks_yml_experiment("12345")
        content = (tmp_path / "databricks.yml").read_text()
        assert "bundle:" in content
        assert "agent_langgraph" in content
        assert "targets:" in content
        assert "mode: development" in content

    def test_handles_missing_file(self, tmp_path):
        update_databricks_yml_experiment("12345")
        assert not (tmp_path / "databricks.yml").exists()

    def test_preserves_lakebase_env_vars(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(LAKEBASE_YML)
        update_databricks_yml_experiment("12345")
        content = (tmp_path / "databricks.yml").read_text()
        assert "LAKEBASE_AUTOSCALING_ENDPOINT" in content

    def test_handles_double_quoted_experiment_name(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(DOUBLE_QUOTED_YML)
        update_databricks_yml_experiment("99999")
        content = (tmp_path / "databricks.yml").read_text()
        assert 'experiment_id: "99999"' in content

    def test_no_experiments_resource_section(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(MINIMAL_YML)
        update_databricks_yml_experiment("12345")
        content = (tmp_path / "databricks.yml").read_text()
        assert "experiments:" not in content

    def test_against_real_template_files(self, tmp_path):
        repo_root = Path(__file__).resolve().parents[1]
        templates_with_experiment = [
            "agent-langgraph",
            "agent-langgraph-advanced",
            "agent-openai-agents-sdk",
            "agent-openai-advanced",
            "agent-openai-agents-sdk-multiagent",
            "agent-non-conversational",
        ]
        for template_name in templates_with_experiment:
            yml_path = repo_root / template_name / "databricks.yml"
            if not yml_path.exists():
                continue
            # Work in a temp subdirectory per template
            tdir = tmp_path / template_name
            tdir.mkdir()
            (tdir / "databricks.yml").write_text(yml_path.read_text())
            os.chdir(tdir)

            update_databricks_yml_experiment("99999")
            content = (tdir / "databricks.yml").read_text()
            assert "experiments:" not in content, f"{template_name}: experiments resource section should not exist"
            assert 'experiment_id: "99999"' in content, f"{template_name}: experiment ID not set in resource"


class TestReplaceLakebaseEnvVars:
    """Tests for _replace_lakebase_env_vars helper."""

    def test_autoscaling_sets_endpoint_env_var(self):
        result = _replace_lakebase_env_vars(
            LAKEBASE_YML, {"type": "autoscaling", "endpoint": "my-endpoint"}
        )
        assert "LAKEBASE_AUTOSCALING_ENDPOINT" in result
        assert 'value_from: "postgres"' in result
        assert "LAKEBASE_INSTANCE_NAME" not in result

    def test_autoscaling_removes_legacy_provisioned_env_var(self):
        """A stale provisioned env var (from an old config) should be removed."""
        stale = LAKEBASE_YML.replace(
            '          - name: LAKEBASE_AUTOSCALING_ENDPOINT\n            value_from: "postgres"\n',
            '          - name: LAKEBASE_INSTANCE_NAME\n            value: "old-db"\n',
        )
        result = _replace_lakebase_env_vars(
            stale, {"type": "autoscaling", "endpoint": "ep"}
        )
        assert "LAKEBASE_AUTOSCALING_ENDPOINT" in result
        assert "LAKEBASE_INSTANCE_NAME" not in result

    def test_preserves_non_lakebase_env_vars(self):
        result = _replace_lakebase_env_vars(
            LAKEBASE_YML, {"type": "autoscaling", "endpoint": "x"}
        )
        assert "MLFLOW_EXPERIMENT_ID" in result
        assert 'value_from: "experiment"' in result

    def test_preserves_surrounding_yaml(self):
        result = _replace_lakebase_env_vars(
            LAKEBASE_YML, {"type": "autoscaling", "endpoint": "ep"}
        )
        assert "bundle:" in result
        assert "agent_langgraph_advanced" in result
        assert "targets:" in result
        assert "mode: development" in result

    def test_noop_without_lakebase_env_vars(self):
        result = _replace_lakebase_env_vars(
            MINIMAL_YML, {"type": "autoscaling", "endpoint": "x"}
        )
        assert result == MINIMAL_YML

    def test_indent_matches_existing_env_vars(self):
        result = _replace_lakebase_env_vars(
            LAKEBASE_YML, {"type": "autoscaling", "endpoint": "my-endpoint"}
        )
        # The LAKEBASE env var should be at the same indent as MLFLOW_EXPERIMENT_ID
        for line in result.splitlines():
            if "- name: LAKEBASE_AUTOSCALING_ENDPOINT" in line:
                lakebase_indent = len(line) - len(line.lstrip())
            if "- name: MLFLOW_EXPERIMENT_ID" in line:
                mlflow_indent = len(line) - len(line.lstrip())
        assert lakebase_indent == mlflow_indent

    def test_idempotent_same_type_twice(self):
        """Running the same type twice produces clean output."""
        step1 = _replace_lakebase_env_vars(
            LAKEBASE_YML, {"type": "autoscaling", "endpoint": "ep-1"}
        )
        step2 = _replace_lakebase_env_vars(
            step1, {"type": "autoscaling", "endpoint": "ep-2"}
        )
        assert "LAKEBASE_AUTOSCALING_ENDPOINT" in step2
        assert 'value_from: "postgres"' in step2

    def test_double_quoted_yml(self):
        result = _replace_lakebase_env_vars(
            DOUBLE_QUOTED_YML, {"type": "autoscaling", "endpoint": "prod-ep"}
        )
        assert "LAKEBASE_AUTOSCALING_ENDPOINT" in result
        assert 'value_from: "postgres"' in result
        assert "LAKEBASE_INSTANCE_NAME" not in result


class TestReplaceLakebaseResource:
    """Tests for _replace_lakebase_resource helper (postgres resource section)."""

    def test_autoscaling_fills_postgres_resource(self):
        result = _replace_lakebase_resource(
            LAKEBASE_YML, {"type": "autoscaling", "endpoint": "my-ep", "branch": "projects/p/branches/b", "database": "projects/p/branches/b/databases/db-1"}
        )
        assert "- name: 'postgres'" in result
        assert 'branch: "projects/p/branches/b"' in result
        assert "permission: 'CAN_CONNECT_AND_CREATE'" in result
        # Should not have a database (provisioned) resource
        assert "- name: 'database'" not in result

    def test_removes_legacy_commented_database_resource(self):
        """A stale commented-out provisioned database resource should be removed."""
        stale = LAKEBASE_YML.replace(
            "        # Autoscaling postgres resource\n",
            "        # - name: 'database'\n        #   database:\n        #     instance_name: '<your-lakebase-instance-name>'\n        # Autoscaling postgres resource\n",
        )
        result = _replace_lakebase_resource(
            stale, {"type": "autoscaling", "endpoint": "my-ep"}
        )
        assert "- name: 'database'" not in result
        assert "# - name: 'database'" not in result

    def test_preserves_experiment_resource(self):
        result = _replace_lakebase_resource(
            LAKEBASE_YML, {"type": "autoscaling", "endpoint": "my-ep"}
        )
        assert "- name: 'experiment'" in result
        assert "experiment_id:" in result
        assert "permission: 'CAN_MANAGE'" in result

    def test_preserves_non_resource_content(self):
        result = _replace_lakebase_resource(
            LAKEBASE_YML, {"type": "autoscaling", "endpoint": "x"}
        )
        assert "bundle:" in result
        assert "targets:" in result
        assert "mode: development" in result

    def test_autoscaling_fills_branch_and_database(self):
        result = _replace_lakebase_resource(
            LAKEBASE_YML, {"type": "autoscaling", "branch": "projects/p/branches/b", "database": "projects/p/branches/b/databases/db-1"}
        )
        assert "- name: 'postgres'" in result
        assert 'branch: "projects/p/branches/b"' in result
        assert 'database: "projects/p/branches/b/databases/db-1"' in result
        assert "permission: 'CAN_CONNECT_AND_CREATE'" in result

    def test_noop_autoscaling_without_lakebase_resource(self):
        """Autoscaling on a yml without lakebase resource should be a noop."""
        result = _replace_lakebase_resource(
            MINIMAL_YML, {"type": "autoscaling", "branch": "projects/p/branches/b", "database": "projects/p/branches/b/databases/db-1"}
        )
        assert result == MINIMAL_YML

    def test_idempotent_autoscaling_twice(self):
        """Running autoscaling twice should update branch/database cleanly."""
        step1 = _replace_lakebase_resource(
            LAKEBASE_YML, {"type": "autoscaling", "branch": "projects/p/branches/b1", "database": "projects/p/branches/b1/databases/db-1"}
        )
        step2 = _replace_lakebase_resource(
            step1, {"type": "autoscaling", "branch": "projects/p/branches/b2", "database": "projects/p/branches/b2/databases/db-2"}
        )
        assert 'branch: "projects/p/branches/b2"' in step2
        assert "b1" not in step2

    def test_no_placeholder_in_autoscaling_output(self):
        """Autoscaling should never leave placeholder values like <your-database-id>."""
        result = _replace_lakebase_resource(
            LAKEBASE_YML, {"type": "autoscaling", "endpoint": "real-ep"}
        )
        assert "<your-" not in result.split("# ")[0]  # ignore commented-out sections
        assert "database_id" not in result.split("# ")[0]

    def test_against_real_template_files(self, tmp_path):
        """Verify resource replacement works on actual template databricks.yml files."""
        repo_root = Path(__file__).resolve().parents[1]
        memory_templates = [
            "agent-langgraph-advanced",
            "agent-openai-advanced",
        ]
        for template_name in memory_templates:
            yml_path = repo_root / template_name / "databricks.yml"
            if not yml_path.exists():
                continue
            content = yml_path.read_text()

            # Test autoscaling
            result = _replace_lakebase_resource(
                content, {"type": "autoscaling", "endpoint": "test-ep", "branch": "projects/p/branches/b", "database": "projects/p/branches/b/databases/db-1"}
            )
            assert "# - name: 'database'" not in result, f"{template_name}: commented resource should be removed"
            assert 'branch: "projects/p/branches/b"' in result, f"{template_name}: branch not set in postgres resource"
            # Make sure we didn't add an uncommented database resource
            lines_with_database = [l for l in result.splitlines() if "- name:" in l and "database" in l]
            assert len(lines_with_database) == 0, f"{template_name}: database resource should not exist for autoscaling"


class TestUpdateDatabricksYmlLakebase:
    def test_autoscaling_updates_file(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(LAKEBASE_YML)
        update_databricks_yml_lakebase(
            {"type": "autoscaling", "branch": "projects/p/branches/b", "database": "projects/p/branches/b/databases/db-1"}
        )
        content = (tmp_path / "databricks.yml").read_text()
        assert "LAKEBASE_AUTOSCALING_ENDPOINT" in content
        assert 'value_from: "postgres"' in content
        assert 'branch: "projects/p/branches/b"' in content
        assert 'database: "projects/p/branches/b/databases/db-1"' in content
        assert "LAKEBASE_INSTANCE_NAME" not in content

    def test_noop_autoscaling_without_lakebase(self, tmp_path):
        """Autoscaling on a yml without lakebase env vars should be a noop."""
        (tmp_path / "databricks.yml").write_text(MINIMAL_YML)
        update_databricks_yml_lakebase({"type": "autoscaling", "branch": "projects/p/branches/b", "database": "projects/p/branches/b/databases/db-1"})
        content = (tmp_path / "databricks.yml").read_text()
        assert content == MINIMAL_YML

    def test_handles_missing_file(self, tmp_path):
        update_databricks_yml_lakebase({"type": "autoscaling", "endpoint": "x"})
        assert not (tmp_path / "databricks.yml").exists()

    def test_against_real_template_files(self, tmp_path):
        """Verify lakebase replacement works on actual template databricks.yml files."""
        repo_root = Path(__file__).resolve().parents[1]
        memory_templates = [
            "agent-langgraph-advanced",
            "agent-openai-advanced",
        ]
        for template_name in memory_templates:
            yml_path = repo_root / template_name / "databricks.yml"
            if not yml_path.exists():
                continue

            # Test autoscaling
            tdir = tmp_path / f"{template_name}-autoscaling"
            tdir.mkdir()
            (tdir / "databricks.yml").write_text(yml_path.read_text())
            os.chdir(tdir)
            update_databricks_yml_lakebase(
                {"type": "autoscaling", "endpoint": "test-ep", "branch": "projects/p/branches/b", "database": "projects/p/branches/b/databases/db-1"}
            )
            content = (tdir / "databricks.yml").read_text()
            assert "LAKEBASE_AUTOSCALING_ENDPOINT" in content, (
                f"{template_name}: missing LAKEBASE_AUTOSCALING_ENDPOINT"
            )
            assert 'value_from: "postgres"' in content, f"{template_name}: value_from not set"
            assert 'branch: "projects/p/branches/b"' in content, f"{template_name}: branch not set"
            assert "LAKEBASE_INSTANCE_NAME" not in content, (
                f"{template_name}: provisioned env var should be removed"
            )



class TestCombined:
    def test_experiment_then_autoscaling_lakebase(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(LAKEBASE_YML)
        update_databricks_yml_experiment("54321")
        update_databricks_yml_lakebase(
            {"type": "autoscaling", "endpoint": "my-endpoint"}
        )
        content = (tmp_path / "databricks.yml").read_text()
        assert 'experiment_id: "54321"' in content
        assert "LAKEBASE_AUTOSCALING_ENDPOINT" in content
        assert 'value_from: "postgres"' in content
        assert "LAKEBASE_INSTANCE_NAME" not in content


class TestUpdateEnvFile:
    """Tests for update_env_file helper."""

    def test_creates_new_file(self, tmp_path):
        update_env_file("MY_KEY", "my_value")
        content = (tmp_path / ".env").read_text()
        assert "MY_KEY=my_value" in content

    def test_updates_existing_key(self, tmp_path):
        (tmp_path / ".env").write_text("MY_KEY=old_value\n")
        update_env_file("MY_KEY", "new_value")
        content = (tmp_path / ".env").read_text()
        assert "MY_KEY=new_value" in content
        assert "old_value" not in content

    def test_adds_new_key(self, tmp_path):
        (tmp_path / ".env").write_text("EXISTING=yes\n")
        update_env_file("NEW_KEY", "new_value")
        content = (tmp_path / ".env").read_text()
        assert "EXISTING=yes" in content
        assert "NEW_KEY=new_value" in content

    def test_clears_value(self, tmp_path):
        (tmp_path / ".env").write_text("MY_KEY=something\n")
        update_env_file("MY_KEY", "")
        content = (tmp_path / ".env").read_text()
        assert "MY_KEY=" in content
        assert "something" not in content

    def test_preserves_other_keys(self, tmp_path):
        (tmp_path / ".env").write_text("A=1\nB=2\nC=3\n")
        update_env_file("B", "updated")
        content = (tmp_path / ".env").read_text()
        assert "A=1" in content
        assert "B=updated" in content
        assert "C=3" in content

    def test_preserves_comments(self, tmp_path):
        (tmp_path / ".env").write_text("# This is a comment\nMY_KEY=val\n")
        update_env_file("MY_KEY", "new")
        content = (tmp_path / ".env").read_text()
        assert "# This is a comment" in content

    def test_replaces_commented_out_key(self, tmp_path):
        (tmp_path / ".env").write_text(
            "# Lakebase autoscaling endpoint\n# LAKEBASE_AUTOSCALING_ENDPOINT=\nOTHER=yes\n"
        )
        update_env_file("LAKEBASE_AUTOSCALING_ENDPOINT", "my-ep")
        content = (tmp_path / ".env").read_text()
        assert "LAKEBASE_AUTOSCALING_ENDPOINT=my-ep" in content
        assert "# LAKEBASE_AUTOSCALING_ENDPOINT=" not in content
        assert "OTHER=yes" in content
        # Should not be appended at the end (replaced in-place)
        lines = content.strip().split("\n")
        assert lines[1] == "LAKEBASE_AUTOSCALING_ENDPOINT=my-ep"

    def test_replaces_commented_out_key_with_space(self, tmp_path):
        (tmp_path / ".env").write_text("# LAKEBASE_AUTOSCALING_ENDPOINT=\n")
        update_env_file("LAKEBASE_AUTOSCALING_ENDPOINT", "my-ep")
        content = (tmp_path / ".env").read_text()
        assert "LAKEBASE_AUTOSCALING_ENDPOINT=my-ep" in content
        assert content.count("LAKEBASE_AUTOSCALING_ENDPOINT") == 1

    def test_active_line_removes_leftover_commented_line(self, tmp_path):
        """When an active line exists alongside a commented-out version, the
        commented version should be cleaned up."""
        (tmp_path / ".env").write_text(
            "# LAKEBASE_AUTOSCALING_ENDPOINT=\n"
            "OTHER=yes\n"
            "LAKEBASE_AUTOSCALING_ENDPOINT=old-ep\n"
        )
        update_env_file("LAKEBASE_AUTOSCALING_ENDPOINT", "new-ep")
        content = (tmp_path / ".env").read_text()
        assert "LAKEBASE_AUTOSCALING_ENDPOINT=new-ep" in content
        assert "# LAKEBASE_AUTOSCALING_ENDPOINT=" not in content
        assert content.count("LAKEBASE_AUTOSCALING_ENDPOINT") == 1
        assert "OTHER=yes" in content

    def test_full_env_example_scenario(self, tmp_path):
        """Simulates .env from .env.example with commented lakebase vars
        plus active lines from a previous quickstart run."""
        (tmp_path / ".env").write_text(
            "# TODO: Update with your Lakebase autoscaling endpoint\n"
            "# LAKEBASE_AUTOSCALING_ENDPOINT=\n"
            "\n"
            "CHAT_APP_PORT=3000\n"
            "LAKEBASE_AUTOSCALING_ENDPOINT=old-ep\n"
        )
        # Simulate autoscaling quickstart
        update_env_file("LAKEBASE_AUTOSCALING_ENDPOINT", "new-ep")
        content = (tmp_path / ".env").read_text()
        assert content.count("LAKEBASE_AUTOSCALING_ENDPOINT") == 1
        assert "LAKEBASE_AUTOSCALING_ENDPOINT=new-ep" in content
        assert "# LAKEBASE_AUTOSCALING_ENDPOINT=" not in content
        assert "CHAT_APP_PORT=3000" in content
        # Values should be in the TODO section, not appended at the bottom
        lines = content.strip().split("\n")
        lakebase_idx = next(i for i, l in enumerate(lines) if l.startswith("LAKEBASE_AUTOSCALING_ENDPOINT="))
        chat_idx = next(i for i, l in enumerate(lines) if l.startswith("CHAT_APP_PORT="))
        assert lakebase_idx < chat_idx, "Lakebase vars should be in the TODO section, not appended after CHAT_APP_PORT"

    def test_fresh_env_example_autoscaling(self, tmp_path):
        """First quickstart run on a fresh .env copied from .env.example."""
        (tmp_path / ".env").write_text(
            "# TODO: Update with your Lakebase autoscaling endpoint\n"
            "# LAKEBASE_AUTOSCALING_ENDPOINT=\n"
            "\n"
            "CHAT_APP_PORT=3000\n"
        )
        update_env_file("LAKEBASE_AUTOSCALING_ENDPOINT", "my-ep")
        content = (tmp_path / ".env").read_text()
        # Should appear in-place where the commented line was
        lines = content.strip().split("\n")
        assert "LAKEBASE_AUTOSCALING_ENDPOINT=my-ep" in lines
        # Should be before CHAT_APP_PORT, not appended
        ep_idx = lines.index("LAKEBASE_AUTOSCALING_ENDPOINT=my-ep")
        chat_idx = lines.index("CHAT_APP_PORT=3000")
        assert ep_idx < chat_idx


class TestSetupEnvFile:
    """Tests for setup_env_file (copies .env.example to .env)."""

    def test_copies_env_example(self, tmp_path):
        (tmp_path / ".env.example").write_text("PROFILE=DEFAULT\nMLFLOW_EXPERIMENT_ID=\n")
        setup_env_file()
        assert (tmp_path / ".env").exists()
        content = (tmp_path / ".env").read_text()
        assert "PROFILE=DEFAULT" in content

    def test_does_not_overwrite_existing(self, tmp_path):
        (tmp_path / ".env.example").write_text("NEW=content\n")
        (tmp_path / ".env").write_text("OLD=content\n")
        setup_env_file()
        content = (tmp_path / ".env").read_text()
        assert "OLD=content" in content
        assert "NEW=content" not in content

    def test_creates_minimal_without_example(self, tmp_path):
        setup_env_file()
        assert (tmp_path / ".env").exists()
        content = (tmp_path / ".env").read_text()
        assert "DATABRICKS_CONFIG_PROFILE=DEFAULT" in content


class TestHappyPathAutoscalingOnRealTemplates:
    """End-to-end happy path: autoscaling Lakebase on real template files."""

    MEMORY_TEMPLATES = [
        "agent-langgraph-advanced",
        "agent-openai-advanced",
    ]

    def test_autoscaling_happy_path(self, tmp_path):
        repo_root = Path(__file__).resolve().parents[1]

        for template_name in self.MEMORY_TEMPLATES:
            template_dir = repo_root / template_name
            if not template_dir.exists():
                continue

            # Set up working directory
            tdir = tmp_path / f"{template_name}-autoscaling"
            tdir.mkdir()

            # Copy template files
            for fname in ["databricks.yml", ".env.example"]:
                src = template_dir / fname
                if src.exists():
                    (tdir / fname).write_text(src.read_text())
            if (template_dir / "app.yaml").exists():
                (tdir / "app.yaml").write_text((template_dir / "app.yaml").read_text())

            os.chdir(tdir)

            # Step 1: Copy .env.example to .env
            setup_env_file()
            assert (tdir / ".env").exists(), f"{template_name}: .env not created"

            # Step 2: Set experiment ID
            update_databricks_yml_experiment("67890")

            # Step 3: Set autoscaling lakebase in .env
            update_env_file("LAKEBASE_AUTOSCALING_ENDPOINT", "my-autoscaling-ep")
            update_env_file("LAKEBASE_INSTANCE_NAME", "")
            update_env_file("PGHOST", "ep-abc123.database.us-west-2.cloud.databricks.com")
            update_env_file("PGUSER", "test@databricks.com")
            update_env_file("PGDATABASE", "databricks_postgres")

            # Step 4: Set autoscaling lakebase in databricks.yml
            update_databricks_yml_lakebase(
                {"type": "autoscaling", "endpoint": "my-autoscaling-ep"}
            )

            # Verify .env
            env_content = (tdir / ".env").read_text()
            assert "LAKEBASE_AUTOSCALING_ENDPOINT=my-autoscaling-ep" in env_content, (
                f"{template_name}: .env missing LAKEBASE_AUTOSCALING_ENDPOINT"
            )
            assert "PGHOST=ep-abc123.database.us-west-2.cloud.databricks.com" in env_content, (
                f"{template_name}: .env missing PGHOST"
            )
            assert "PGUSER=test@databricks.com" in env_content, (
                f"{template_name}: .env missing PGUSER"
            )
            assert "PGDATABASE=databricks_postgres" in env_content, (
                f"{template_name}: .env missing PGDATABASE"
            )

            # Verify databricks.yml
            yml_content = (tdir / "databricks.yml").read_text()
            assert 'experiment_id: "67890"' in yml_content, (
                f"{template_name}: databricks.yml missing experiment_id"
            )
            assert "LAKEBASE_AUTOSCALING_ENDPOINT" in yml_content, (
                f"{template_name}: databricks.yml missing LAKEBASE_AUTOSCALING_ENDPOINT"
            )
            assert 'value_from: "postgres"' in yml_content, (
                f"{template_name}: databricks.yml missing value_from for endpoint"
            )
            assert 'endpoint: "my-autoscaling-ep"' in yml_content, (
                f"{template_name}: databricks.yml missing endpoint in postgres resource"
            )
            assert "LAKEBASE_INSTANCE_NAME" not in yml_content, (
                f"{template_name}: databricks.yml should not have provisioned instance name"
            )
            # Should NOT have database resource
            lines_with_database = [
                l
                for l in yml_content.splitlines()
                if "- name:" in l and "database" in l
            ]
            assert len(lines_with_database) == 0, (
                f"{template_name}: databricks.yml should not have database resource"
            )
            # Should NOT have any placeholder values in active (non-commented) lines
            for line in yml_content.splitlines():
                if not line.strip().startswith("#"):
                    assert "<your-" not in line, (
                        f"{template_name}: placeholder found in active line: {line.strip()}"
                    )


def _uc_request(warehouse_id="0123456789abcdef"):
    return SimpleNamespace(
        warehouse_id=warehouse_id,
        catalog_name="main",
        schema_name="agent_traces",
        table_prefix="agents_on_apps",
    )


def _uc_location(catalog="main", schema="agent_traces", prefix="agents_on_apps"):
    return UnityCatalog(catalog_name=catalog, schema_name=schema, table_prefix=prefix)


def _experiment(location=None, name="/Users/user@example.com/agents-on-apps"):
    return SimpleNamespace(
        experiment_id="12345",
        name=name,
        trace_location=location,
    )


def _workspace_with_warehouse(warehouse_id="0123456789abcdef"):
    workspace = MagicMock()
    workspace.warehouses.get.return_value = SimpleNamespace(
        id=warehouse_id,
        state=SimpleNamespace(value="RUNNING"),
    )
    return workspace


class TestUcTraceExperimentSetup:
    """Supported UC setup is mandatory; an ordinary experiment is never a fallback."""

    def test_fresh_setup_uses_supported_uc_location_and_returns_full_config(self, monkeypatch):
        workspace = _workspace_with_warehouse()
        mock_set_experiment = Mock(return_value=_experiment(_uc_location()))
        mock_get_by_name = Mock(return_value=None)
        mock_create_ordinary = workspace.experiments.create_experiment

        monkeypatch.setattr(quickstart, "get_workspace_client", lambda _profile: workspace)
        monkeypatch.setattr("mlflow.set_experiment", mock_set_experiment)
        monkeypatch.setattr("mlflow.get_experiment_by_name", mock_get_by_name)

        trace_config = quickstart.create_or_reuse_uc_trace_experiment(
            "DEFAULT", "user@example.com", _uc_request()
        )

        assert trace_config == quickstart.MlflowTraceConfig(
            experiment_name="/Users/user@example.com/agents-on-apps",
            experiment_id="12345",
            warehouse_id="0123456789abcdef",
            catalog_name="main",
            schema_name="agent_traces",
            table_prefix="agents_on_apps",
            otel_spans_table_name="main.agent_traces.agents_on_apps_otel_spans",
        )
        mock_set_experiment.assert_called_once_with(
            experiment_name="/Users/user@example.com/agents-on-apps",
            trace_location=UnityCatalog(
                catalog_name="main",
                schema_name="agent_traces",
                table_prefix="agents_on_apps",
            ),
        )
        mock_create_ordinary.assert_not_called()

    def test_exact_location_reuse_keeps_the_same_experiment(self, monkeypatch):
        workspace = _workspace_with_warehouse()
        existing = _experiment(_uc_location())
        mock_set_experiment = Mock(return_value=existing)
        monkeypatch.setattr(quickstart, "get_workspace_client", lambda _profile: workspace)
        monkeypatch.setattr("mlflow.get_experiment_by_name", Mock(return_value=existing))
        monkeypatch.setattr("mlflow.set_experiment", mock_set_experiment)

        result = quickstart.create_or_reuse_uc_trace_experiment(
            "DEFAULT", "user@example.com", _uc_request()
        )

        assert result.experiment_id == "12345"
        assert result.otel_spans_table_name == "main.agent_traces.agents_on_apps_otel_spans"
        mock_set_experiment.assert_called_once()
        workspace.experiments.create_experiment.assert_not_called()

    def test_conflicting_immutable_location_is_fatal_and_names_both_locations(
        self, monkeypatch
    ):
        workspace = _workspace_with_warehouse()
        existing = _experiment(_uc_location("legacy", "traces", "old_prefix"))
        mock_set_experiment = Mock()
        monkeypatch.setattr(quickstart, "get_workspace_client", lambda _profile: workspace)
        monkeypatch.setattr("mlflow.get_experiment_by_name", Mock(return_value=existing))
        monkeypatch.setattr("mlflow.set_experiment", mock_set_experiment)

        with pytest.raises(RuntimeError) as error:
            quickstart.create_or_reuse_uc_trace_experiment(
                "DEFAULT", "user@example.com", _uc_request()
            )

        message = str(error.value)
        assert "/Users/user@example.com/agents-on-apps" in message
        assert "legacy.traces.old_prefix" in message
        assert "main.agent_traces.agents_on_apps" in message
        assert "--mlflow-experiment-name" in message
        mock_set_experiment.assert_not_called()
        workspace.experiments.create_experiment.assert_not_called()

    def test_missing_uc_preview_is_fatal_without_ordinary_experiment_fallback(
        self, monkeypatch
    ):
        workspace = _workspace_with_warehouse()
        monkeypatch.setattr(quickstart, "get_workspace_client", lambda _profile: workspace)
        monkeypatch.setattr("mlflow.get_experiment_by_name", Mock(return_value=None))
        monkeypatch.setattr(
            "mlflow.set_experiment",
            Mock(side_effect=RuntimeError("Unity Catalog tracing preview is not enabled")),
        )

        with pytest.raises(RuntimeError, match="preview is not enabled"):
            quickstart.create_or_reuse_uc_trace_experiment(
                "DEFAULT", "user@example.com", _uc_request()
            )

        workspace.experiments.create_experiment.assert_not_called()

    def test_unavailable_requested_warehouse_is_fatal_before_mlflow_setup(self, monkeypatch):
        workspace = MagicMock()
        workspace.warehouses.get.side_effect = RuntimeError("warehouse not found")
        mock_set_experiment = Mock()
        monkeypatch.setattr(quickstart, "get_workspace_client", lambda _profile: workspace)
        monkeypatch.setattr("mlflow.set_experiment", mock_set_experiment)

        with pytest.raises(RuntimeError, match="0123456789abcdef"):
            quickstart.create_or_reuse_uc_trace_experiment(
                "DEFAULT", "user@example.com", _uc_request()
            )

        mock_set_experiment.assert_not_called()
        workspace.experiments.create_experiment.assert_not_called()

    def test_selects_an_available_warehouse_when_no_noninteractive_default_exists(
        self, monkeypatch
    ):
        workspace = MagicMock()
        workspace.warehouses.list.return_value = [
            SimpleNamespace(id="deleted", state=SimpleNamespace(value="DELETED")),
            SimpleNamespace(id="running-warehouse", state=SimpleNamespace(value="RUNNING")),
        ]
        experiment = _experiment(_uc_location())
        monkeypatch.setattr(quickstart, "get_workspace_client", lambda _profile: workspace)
        monkeypatch.setattr("mlflow.get_experiment_by_name", Mock(return_value=None))
        monkeypatch.setattr("mlflow.set_experiment", Mock(return_value=experiment))

        result = quickstart.create_or_reuse_uc_trace_experiment(
            "DEFAULT", "user@example.com", _uc_request(warehouse_id=None)
        )

        assert result.warehouse_id == "running-warehouse"

    def test_scopes_selected_profile_for_mlflow_internal_warehouse_auth(
        self, monkeypatch
    ):
        workspace = _workspace_with_warehouse()
        monkeypatch.setenv("DATABRICKS_CONFIG_PROFILE", "outer-profile")
        monkeypatch.setattr(quickstart, "get_workspace_client", lambda _profile: workspace)
        monkeypatch.setattr("mlflow.get_experiment_by_name", Mock(return_value=None))

        def set_experiment(**_kwargs):
            assert os.environ["DATABRICKS_CONFIG_PROFILE"] == "selected-profile"
            return _experiment(_uc_location())

        monkeypatch.setattr("mlflow.set_experiment", Mock(side_effect=set_experiment))

        quickstart.create_or_reuse_uc_trace_experiment(
            "selected-profile", "user@example.com", _uc_request()
        )

        assert os.environ["DATABRICKS_CONFIG_PROFILE"] == "outer-profile"

    def test_explicit_experiment_name_selects_a_new_immutable_binding(self, monkeypatch):
        workspace = _workspace_with_warehouse()
        request = _uc_request()
        request.experiment_name = "/Users/user@example.com/agents-on-apps-unique"
        experiment = _experiment(_uc_location(), name=request.experiment_name)
        mock_set_experiment = Mock(return_value=experiment)
        mock_get_by_name = Mock(return_value=None)
        monkeypatch.setattr(quickstart, "get_workspace_client", lambda _profile: workspace)
        monkeypatch.setattr("mlflow.get_experiment_by_name", mock_get_by_name)
        monkeypatch.setattr("mlflow.set_experiment", mock_set_experiment)

        result = quickstart.create_or_reuse_uc_trace_experiment(
            "DEFAULT", "user@example.com", request
        )

        assert result.experiment_name == request.experiment_name
        mock_get_by_name.assert_called_once_with(request.experiment_name)
        assert mock_set_experiment.call_args.kwargs["experiment_name"] == request.experiment_name


class TestUcTraceAppPermissions:
    def test_missing_app_is_deferred_until_after_first_deploy(self):
        from databricks.sdk.errors import NotFound

        workspace = MagicMock()
        workspace.apps.get.side_effect = NotFound("app does not exist")

        assert quickstart.get_existing_app(workspace, "future-app") is None

    def test_app_lookup_setup_failure_is_fatal(self):
        workspace = MagicMock()
        workspace.apps.get.side_effect = RuntimeError("apps API unavailable")

        with pytest.raises(RuntimeError, match="apps API unavailable"):
            quickstart.get_existing_app(workspace, "future-app")

    def test_grants_modify_to_tables_and_select_to_every_trace_entity(self):
        workspace = MagicMock()
        workspace.apps.get.return_value = SimpleNamespace(
            service_principal_client_id="app-client-id"
        )
        responses = [
            SimpleNamespace(
                status=SimpleNamespace(state=SimpleNamespace(value="SUCCEEDED")),
                result=SimpleNamespace(
                    data_array=[
                        ["agents_on_apps_otel_annotations", "MANAGED"],
                        ["agents_on_apps_otel_logs", "MANAGED"],
                        ["agents_on_apps_otel_metrics", "MANAGED"],
                        ["agents_on_apps_otel_spans", "MANAGED"],
                        ["agents_on_apps_trace_metadata", "VIEW"],
                        ["agents_on_apps_trace_unified", "VIEW"],
                    ]
                ),
            )
        ] + [
            SimpleNamespace(
                status=SimpleNamespace(state=SimpleNamespace(value="SUCCEEDED")),
                result=SimpleNamespace(data_array=[]),
            )
            for _ in range(12)
        ]
        workspace.statement_execution.execute_statement.side_effect = responses

        quickstart.grant_uc_trace_access_to_app(
            workspace,
            "existing-agent-app",
            quickstart.MlflowTraceConfig(
                "/Users/user@example.com/agents-on-apps",
                "12345",
                "0123456789abcdef",
                "main",
                "agent_traces",
                "agents_on_apps",
                "main.agent_traces.agents_on_apps_otel_spans",
            ),
        )

        workspace.apps.get.assert_called_once_with("existing-agent-app")
        statements = [
            call.kwargs["statement"]
            for call in workspace.statement_execution.execute_statement.call_args_list
        ]
        assert statements[1:] == [
            "GRANT USE CATALOG ON CATALOG `main` TO `app-client-id`",
            "GRANT USE SCHEMA ON SCHEMA `main`.`agent_traces` TO `app-client-id`",
            "GRANT MODIFY ON TABLE `main`.`agent_traces`.`agents_on_apps_otel_annotations` TO `app-client-id`",
            "GRANT SELECT ON TABLE `main`.`agent_traces`.`agents_on_apps_otel_annotations` TO `app-client-id`",
            "GRANT MODIFY ON TABLE `main`.`agent_traces`.`agents_on_apps_otel_logs` TO `app-client-id`",
            "GRANT SELECT ON TABLE `main`.`agent_traces`.`agents_on_apps_otel_logs` TO `app-client-id`",
            "GRANT MODIFY ON TABLE `main`.`agent_traces`.`agents_on_apps_otel_metrics` TO `app-client-id`",
            "GRANT SELECT ON TABLE `main`.`agent_traces`.`agents_on_apps_otel_metrics` TO `app-client-id`",
            "GRANT MODIFY ON TABLE `main`.`agent_traces`.`agents_on_apps_otel_spans` TO `app-client-id`",
            "GRANT SELECT ON TABLE `main`.`agent_traces`.`agents_on_apps_otel_spans` TO `app-client-id`",
            "GRANT SELECT ON VIEW `main`.`agent_traces`.`agents_on_apps_trace_metadata` TO `app-client-id`",
            "GRANT SELECT ON VIEW `main`.`agent_traces`.`agents_on_apps_trace_unified` TO `app-client-id`",
        ]
        assert "ALL PRIVILEGES" not in "\n".join(statements)


class TestAtomicMlflowTraceEnv:
    def test_writes_all_six_trace_values_in_one_atomic_replace(self, tmp_path, monkeypatch):
        env_file = tmp_path / ".env"
        env_file.write_text(
            "DATABRICKS_CONFIG_PROFILE=DEFAULT\n"
            "MLFLOW_EXPERIMENT_ID=stale\n"
            "MLFLOW_EXPERIMENT_ID=duplicate\n"
        )
        trace_config = SimpleNamespace(
            experiment_id="12345",
            warehouse_id="0123456789abcdef",
            catalog_name="main",
            schema_name="agent_traces",
            table_prefix="agents_on_apps",
            otel_spans_table_name="main.agent_traces.agents_on_apps_otel_spans",
        )
        real_replace = os.replace
        replacements = []

        def recording_replace(source, destination):
            replacements.append((Path(source), Path(destination)))
            real_replace(source, destination)

        monkeypatch.setattr(os, "replace", recording_replace)

        quickstart.write_mlflow_trace_env_atomically(trace_config, env_file)

        assert len(replacements) == 1
        assert replacements[0][1] == env_file
        active = {
            line.split("=", 1)[0]: line.split("=", 1)[1]
            for line in env_file.read_text().splitlines()
            if line and not line.startswith("#") and "=" in line
        }
        assert active == {
            "DATABRICKS_CONFIG_PROFILE": "DEFAULT",
            "MLFLOW_EXPERIMENT_ID": "12345",
            "MLFLOW_TRACING_SQL_WAREHOUSE_ID": "0123456789abcdef",
            "MLFLOW_UC_CATALOG": "main",
            "MLFLOW_UC_SCHEMA": "agent_traces",
            "MLFLOW_UC_TABLE_PREFIX": "agents_on_apps",
            "MLFLOW_OTEL_SPANS_TABLE": "main.agent_traces.agents_on_apps_otel_spans",
        }


class TestMlflowTraceCliAndRuntimeConfig:
    def test_cli_defaults_to_environment_backed_uc_coordinates(self, monkeypatch):
        monkeypatch.setenv("MLFLOW_UC_CATALOG", "team_catalog")
        monkeypatch.setenv("MLFLOW_UC_SCHEMA", "observability")
        monkeypatch.setenv("MLFLOW_UC_TABLE_PREFIX", "agent_prod")
        monkeypatch.setenv("MLFLOW_TRACING_SQL_WAREHOUSE_ID", "warehouse-from-env")
        monkeypatch.setenv(
            "MLFLOW_EXPERIMENT_NAME", "/Users/user@example.com/agents-on-apps-unique"
        )

        args = quickstart._parse_args([])

        assert args.mlflow_catalog == "team_catalog"
        assert args.mlflow_schema == "observability"
        assert args.mlflow_table_prefix == "agent_prod"
        assert args.mlflow_warehouse_id == "warehouse-from-env"
        assert args.mlflow_experiment_name == (
            "/Users/user@example.com/agents-on-apps-unique"
        )

    def test_persists_six_values_and_warehouse_resource_to_bundle_and_app_yaml(
        self, tmp_path
    ):
        (tmp_path / "databricks.yml").write_text(MINIMAL_YML)
        (tmp_path / "app.yaml").write_text(
            "command: [\"uv\", \"run\", \"start-app\"]\n"
            "env:\n"
            "  - name: MLFLOW_EXPERIMENT_ID\n"
            "    valueFrom: experiment\n"
        )
        config = quickstart.MlflowTraceConfig(
            "/Users/user@example.com/agents-on-apps",
            "12345",
            "0123456789abcdef",
            "main",
            "agent_traces",
            "agents_on_apps",
            "main.agent_traces.agents_on_apps_otel_spans",
        )

        quickstart.update_mlflow_trace_runtime_config(config)

        _, bundle = quickstart._load_yml(tmp_path / "databricks.yml")
        app = next(iter(bundle["resources"]["apps"].values()))
        env_by_name = {entry["name"]: entry for entry in app["config"]["env"]}
        assert env_by_name["MLFLOW_EXPERIMENT_ID"] == {
            "name": "MLFLOW_EXPERIMENT_ID",
            "value_from": "experiment",
        }
        assert env_by_name["MLFLOW_TRACING_SQL_WAREHOUSE_ID"] == {
            "name": "MLFLOW_TRACING_SQL_WAREHOUSE_ID",
            "value_from": "mlflow-tracing-warehouse",
        }
        assert env_by_name["MLFLOW_UC_CATALOG"]["value"] == "main"
        assert env_by_name["MLFLOW_UC_SCHEMA"]["value"] == "agent_traces"
        assert env_by_name["MLFLOW_UC_TABLE_PREFIX"]["value"] == "agents_on_apps"
        assert env_by_name["MLFLOW_OTEL_SPANS_TABLE"]["value"] == (
            "main.agent_traces.agents_on_apps_otel_spans"
        )
        resources = {entry["name"]: entry for entry in app["resources"]}
        assert resources["experiment"]["experiment"]["experiment_id"] == "12345"
        assert resources["mlflow-tracing-warehouse"] == {
            "name": "mlflow-tracing-warehouse",
            "sql_warehouse": {
                "id": "0123456789abcdef",
                "permission": "CAN_USE",
            },
        }

        _, app_yaml = quickstart._load_yml(tmp_path / "app.yaml")
        app_env = {entry["name"]: entry for entry in app_yaml["env"]}
        assert app_env["MLFLOW_EXPERIMENT_ID"]["valueFrom"] == "experiment"
        assert app_env["MLFLOW_TRACING_SQL_WAREHOUSE_ID"]["valueFrom"] == (
            "mlflow-tracing-warehouse"
        )
        assert app_env["MLFLOW_OTEL_SPANS_TABLE"]["value"] == (
            "main.agent_traces.agents_on_apps_otel_spans"
        )


class TestUpdateDatabricksYmlAppName:
    """Tests for update_databricks_yml_app_name."""

    def test_sets_app_name(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(MINIMAL_YML_WITH_APP_NAME)
        bundle_key = update_databricks_yml_app_name("agent-my-new-app")
        content = (tmp_path / "databricks.yml").read_text()
        assert 'name: "agent-my-new-app"' in content
        # Bundle name should not be changed (it's unquoted)
        assert "name: agent_langgraph" in content

    def test_returns_bundle_key(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(MINIMAL_YML_WITH_APP_NAME)
        bundle_key = update_databricks_yml_app_name("agent-my-new-app")
        assert bundle_key == "agent_langgraph"

    def test_adds_budget_policy_id(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(MINIMAL_YML_WITH_APP_NAME)
        update_databricks_yml_app_name("agent-my-app", budget_policy_id="abc-123")
        content = (tmp_path / "databricks.yml").read_text()
        assert 'budget_policy_id: "abc-123"' in content

    def test_no_budget_policy_id_when_none(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(MINIMAL_YML_WITH_APP_NAME)
        update_databricks_yml_app_name("agent-my-app", budget_policy_id=None)
        content = (tmp_path / "databricks.yml").read_text()
        assert "budget_policy_id" not in content

    def test_handles_missing_file(self, tmp_path):
        result = update_databricks_yml_app_name("agent-my-app")
        assert result == ""
        assert not (tmp_path / "databricks.yml").exists()

    def test_against_real_template_files(self, tmp_path):
        repo_root = Path(__file__).resolve().parents[1]
        templates = [
            "agent-langgraph",
            "agent-langgraph-advanced",
            "agent-openai-agents-sdk",
            "agent-openai-advanced",
            "agent-non-conversational",
        ]
        for template_name in templates:
            yml_path = repo_root / template_name / "databricks.yml"
            if not yml_path.exists():
                continue
            tdir = tmp_path / template_name
            tdir.mkdir()
            (tdir / "databricks.yml").write_text(yml_path.read_text())
            os.chdir(tdir)

            bundle_key = update_databricks_yml_app_name("agent-test-app")
            content = (tdir / "databricks.yml").read_text()
            assert 'name: "agent-test-app"' in content, (
                f"{template_name}: app name not updated"
            )
            assert bundle_key != "", f"{template_name}: bundle key not found"


class TestLakebaseIdempotency:
    """Tests for get_existing_lakebase_config."""

    def test_detects_existing_autoscaling_config(self, tmp_path):
        (tmp_path / ".env").write_text(
            "LAKEBASE_AUTOSCALING_ENDPOINT=my-endpoint\n"
        )
        result = get_existing_lakebase_config()
        assert result == {"type": "autoscaling", "endpoint": "my-endpoint"}

    def test_returns_none_when_not_configured(self, tmp_path):
        (tmp_path / ".env").write_text("DATABRICKS_CONFIG_PROFILE=DEFAULT\n")
        result = get_existing_lakebase_config()
        assert result is None

    def test_returns_none_when_no_env_file(self, tmp_path):
        result = get_existing_lakebase_config()
        assert result is None


class TestLakebaseForNonMemoryTemplate:
    """Tests that Lakebase setup is a noop on non-memory templates (no lakebase resource)."""

    def test_autoscaling_noop_on_minimal_yml(self):
        result = _replace_lakebase_resource(
            MINIMAL_YML, {"type": "autoscaling", "endpoint": "ep"}
        )
        assert result == MINIMAL_YML

    def test_env_vars_noop_on_minimal_yml(self):
        """Non-memory templates have no LAKEBASE_ env vars in databricks.yml — noop."""
        result = _replace_lakebase_env_vars(
            MINIMAL_YML, {"type": "autoscaling", "endpoint": "ep"}
        )
        assert result == MINIMAL_YML


class TestGetDatabricksYmlExperimentId:
    """Tests for get_databricks_yml_experiment_id — reads already-set experiment_id from YAML."""

    def test_returns_id_when_set(self, tmp_path):
        yml = MINIMAL_YML.replace('experiment_id: ""', 'experiment_id: "555"')
        (tmp_path / "databricks.yml").write_text(yml)
        assert get_databricks_yml_experiment_id() == "555"

    def test_returns_empty_when_placeholder(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(MINIMAL_YML)
        assert get_databricks_yml_experiment_id() == ""

    def test_returns_empty_when_file_missing(self, tmp_path):
        assert get_databricks_yml_experiment_id() == ""

    def test_returns_id_for_lakebase_template(self, tmp_path):
        yml = LAKEBASE_YML.replace('experiment_id: ""', 'experiment_id: "999"')
        (tmp_path / "databricks.yml").write_text(yml)
        assert get_databricks_yml_experiment_id() == "999"


class TestValidateLakebaseConfig:
    """Tests for validate_lakebase_config — validates .env lakebase before reusing."""

    def test_autoscaling_valid(self):
        config = {"type": "autoscaling", "endpoint": "my-ep"}
        with patch("quickstart.validate_lakebase_autoscaling_endpoint", return_value={"endpoint": "my-ep"}):
            assert validate_lakebase_config("DEFAULT", config) is True

    def test_autoscaling_invalid(self):
        config = {"type": "autoscaling", "endpoint": "missing-ep"}
        with patch("quickstart.validate_lakebase_autoscaling_endpoint", return_value=None):
            assert validate_lakebase_config("DEFAULT", config) is False

    def test_autoscaling_calls_correct_validator(self):
        config = {"type": "autoscaling", "endpoint": "my-ep"}
        with patch("quickstart.validate_lakebase_autoscaling_endpoint", return_value={}) as mock_validate:
            validate_lakebase_config("my-profile", config)
        mock_validate.assert_called_once_with("my-profile", "my-ep")


# Required env vars that must be set after any successful quickstart run with lakebase
REQUIRED_ENV_VARS_AUTOSCALING = [
    "MLFLOW_EXPERIMENT_ID",
    "LAKEBASE_AUTOSCALING_ENDPOINT",
    "PGHOST",
    "PGUSER",
]

class TestRequiredEnvVarsContract:
    """Verifies that all required env vars are populated after quickstart completes.

    Every quickstart path (autoscaling, app-bind) must set:
    - MLFLOW_EXPERIMENT_ID
    - PGHOST
    - PGUSER
    - LAKEBASE_AUTOSCALING_ENDPOINT
    """

    def _setup_env(self, tmp_path, template_name):
        repo_root = Path(__file__).resolve().parents[1]
        template_dir = repo_root / template_name
        tdir = tmp_path / template_name
        tdir.mkdir(parents=True, exist_ok=True)
        for fname in ["databricks.yml", ".env.example"]:
            src = template_dir / fname
            if src.exists():
                (tdir / fname).write_text(src.read_text())
        if (template_dir / "app.yaml").exists():
            (tdir / "app.yaml").write_text((template_dir / "app.yaml").read_text())
        os.chdir(tdir)
        setup_env_file()
        return tdir

    def _assert_env_has_vars(self, tdir, required_vars, template_name, scenario):
        env_content = (tdir / ".env").read_text()
        for var in required_vars:
            # Check the var is present and has a non-empty value
            match = None
            for line in env_content.splitlines():
                if line.startswith(f"{var}=") and not line.startswith("#"):
                    match = line
                    break
            assert match is not None, (
                f"{template_name} ({scenario}): .env missing {var}"
            )
            value = match.split("=", 1)[1]
            assert value != "", (
                f"{template_name} ({scenario}): .env has empty {var}"
            )

    MEMORY_TEMPLATES = [
        "agent-langgraph-advanced",
        "agent-openai-advanced",
    ]

    def test_autoscaling_sets_all_required_env_vars(self, tmp_path):
        for template_name in self.MEMORY_TEMPLATES:
            tdir = self._setup_env(tmp_path / "auto", template_name)
            update_databricks_yml_experiment("12345")
            update_env_file("MLFLOW_EXPERIMENT_ID", "12345")
            update_env_file("LAKEBASE_AUTOSCALING_ENDPOINT", "projects/p/branches/b/endpoints/primary")
            update_env_file("LAKEBASE_INSTANCE_NAME", "")
            update_env_file("PGHOST", "ep-abc.database.us-west-2.cloud.databricks.com")
            update_env_file("PGUSER", "user@databricks.com")
            self._assert_env_has_vars(
                tdir, REQUIRED_ENV_VARS_AUTOSCALING, template_name, "autoscaling"
            )

    def test_app_bind_autoscaling_sets_all_required_env_vars(self, tmp_path):
        """Simulates what happens when quickstart binds to an existing app with postgres."""
        for template_name in self.MEMORY_TEMPLATES:
            tdir = self._setup_env(tmp_path / "app-auto", template_name)
            # Simulate app-bind: these are set by the quickstart app-bind path
            update_env_file("MLFLOW_EXPERIMENT_ID", "99999")
            update_env_file("LAKEBASE_AUTOSCALING_ENDPOINT", "projects/p/branches/b/endpoints/primary")
            update_env_file("LAKEBASE_INSTANCE_NAME", "")
            update_env_file("PGHOST", "ep-xyz.database.us-west-2.cloud.databricks.com")
            update_env_file("PGUSER", "user@databricks.com")
            self._assert_env_has_vars(
                tdir, REQUIRED_ENV_VARS_AUTOSCALING, template_name, "app-bind autoscaling"
            )


class TestLakebaseCreateNew:
    """Tests for --lakebase-create-new flag (non-interactive Lakebase provisioning)."""

    @staticmethod
    def _mock_endpoint_info(project="test-proj", branch="test-proj-branch"):
        return {
            "endpoint": f"projects/{project}/branches/{branch}/endpoints/primary",
            "host": "ep-xxx.database.us-west-2.cloud.databricks.com",
            "branch": f"projects/{project}/branches/{branch}",
            "database": f"projects/{project}/branches/{branch}/databases/db-xxx",
        }

    def test_create_lakebase_instance_uses_name_without_prompting(self, tmp_path):
        """When name kwarg is passed, create_lakebase_instance does NOT call input()."""
        os.chdir(tmp_path)
        mock_w = MagicMock()
        mock_project = MagicMock()
        mock_project.name = "projects/my-new-project"
        mock_w.postgres.create_project.return_value.wait.return_value = mock_project
        mock_branch = MagicMock()
        mock_branch.name = "projects/my-new-project/branches/my-new-project-branch"
        mock_w.postgres.create_branch.return_value.wait.return_value = mock_branch

        with patch("quickstart.get_workspace_client", return_value=mock_w), patch(
            "quickstart.validate_lakebase_autoscaling_endpoint",
            return_value=self._mock_endpoint_info(
                project="my-new-project", branch="my-new-project-branch"
            ),
        ), patch("builtins.input") as mock_input:
            result = create_lakebase_instance("DEFAULT", "my-new-project")

        mock_input.assert_not_called()
        mock_w.postgres.create_project.assert_called_once()
        mock_w.postgres.create_branch.assert_called_once()
        assert result["type"] == "autoscaling"
        assert result["endpoint"].endswith("/endpoints/primary")
        assert result["host"] == "ep-xxx.database.us-west-2.cloud.databricks.com"

    def test_setup_lakebase_create_new_writes_env_vars(self, tmp_path):
        """setup_lakebase(create_new_lakebase_proj=X) writes all required env vars to .env."""
        os.chdir(tmp_path)
        (tmp_path / ".env").write_text("DATABRICKS_CONFIG_PROFILE=DEFAULT\n")
        # Pre-seed a stale instance name to verify it gets cleared
        update_env_file("LAKEBASE_INSTANCE_NAME", "stale-instance")

        endpoint_info = {**self._mock_endpoint_info(), "type": "autoscaling"}
        with patch("quickstart.create_lakebase_instance", return_value=endpoint_info):
            result = setup_lakebase(
                profile_name="DEFAULT",
                username="test@example.com",
                create_new_lakebase_proj="test-proj",
                purpose="memory",
            )

        env_content = (tmp_path / ".env").read_text()
        assert (
            "LAKEBASE_AUTOSCALING_ENDPOINT=projects/test-proj/branches/test-proj-branch/endpoints/primary"
            in env_content
        )
        assert "PGHOST=ep-xxx.database.us-west-2.cloud.databricks.com" in env_content
        assert "PGUSER=test@example.com" in env_content
        assert "PGDATABASE=databricks_postgres" in env_content
        # Stale instance name should be cleared
        assert "LAKEBASE_INSTANCE_NAME=stale-instance" not in env_content
        assert "LAKEBASE_INSTANCE_NAME=" in env_content
        # Return value is the endpoint config dict
        assert result["type"] == "autoscaling"
        assert result["endpoint"].startswith("projects/test-proj/")

    def test_setup_lakebase_create_new_passes_name_through(self, tmp_path):
        """setup_lakebase forwards create_new_lakebase_proj verbatim to create_lakebase_instance."""
        os.chdir(tmp_path)
        (tmp_path / ".env").write_text("DATABRICKS_CONFIG_PROFILE=DEFAULT\n")

        endpoint_info = {**self._mock_endpoint_info(project="custom-name"), "type": "autoscaling"}
        with patch(
            "quickstart.create_lakebase_instance", return_value=endpoint_info
        ) as mock_create:
            setup_lakebase(
                profile_name="DEFAULT",
                username="test@example.com",
                create_new_lakebase_proj="custom-name",
                purpose="memory",
            )

        mock_create.assert_called_once_with("DEFAULT", "custom-name")

    def test_end_to_end_create_new_chain(self, tmp_path):
        """Seam test: setup_lakebase → create_lakebase_instance → endpoint validation.

        Mocks only the deepest layer (workspace SDK + endpoint API). Catches contract
        drift between setup_lakebase, create_lakebase_instance, and validate_lakebase_autoscaling_endpoint.
        """
        os.chdir(tmp_path)
        (tmp_path / ".env").write_text("DATABRICKS_CONFIG_PROFILE=DEFAULT\n")

        mock_w = MagicMock()
        mock_project = MagicMock()
        mock_project.name = "projects/integration-test"
        mock_w.postgres.create_project.return_value.wait.return_value = mock_project
        mock_branch = MagicMock()
        mock_branch.name = "projects/integration-test/branches/integration-test-branch"
        mock_w.postgres.create_branch.return_value.wait.return_value = mock_branch

        endpoint_info = self._mock_endpoint_info(
            project="integration-test", branch="integration-test-branch"
        )

        with patch("quickstart.get_workspace_client", return_value=mock_w), patch(
            "quickstart.validate_lakebase_autoscaling_endpoint", return_value=endpoint_info
        ) as mock_validate:
            result = setup_lakebase(
                profile_name="DEFAULT",
                username="test@example.com",
                create_new_lakebase_proj="integration-test",
                purpose="memory",
            )

        # SDK was called with the user-supplied name
        assert (
            mock_w.postgres.create_project.call_args.kwargs.get("project_id")
            == "integration-test"
        )
        assert (
            mock_w.postgres.create_branch.call_args.kwargs.get("branch_id")
            == "integration-test-branch"
        )
        # Endpoint validation was called with the constructed resource path
        mock_validate.assert_called_once()
        validated_path = mock_validate.call_args.args[1]
        assert validated_path == (
            "projects/integration-test/branches/integration-test-branch/endpoints/primary"
        )
        # Result dict has the expected shape (all four keys consumed by callers)
        for key in ("type", "endpoint", "host", "branch", "database"):
            assert key in result, f"setup_lakebase return missing key {key!r}"
        assert result["type"] == "autoscaling"
        # .env got populated correctly
        env_content = (tmp_path / ".env").read_text()
        assert "LAKEBASE_AUTOSCALING_ENDPOINT=projects/integration-test/" in env_content
        assert "PGHOST=ep-xxx.database.us-west-2.cloud.databricks.com" in env_content
        assert "PGUSER=test@example.com" in env_content
        assert "PGDATABASE=databricks_postgres" in env_content

    def test_create_lakebase_instance_rejects_empty_name(self, tmp_path):
        """Passing an empty string for name exits non-zero without provisioning."""
        os.chdir(tmp_path)
        mock_w = MagicMock()
        with patch("quickstart.get_workspace_client", return_value=mock_w):
            with pytest.raises(SystemExit) as exc_info:
                create_lakebase_instance("DEFAULT", "")
        assert exc_info.value.code == 1
        mock_w.postgres.create_project.assert_not_called()
        mock_w.postgres.create_branch.assert_not_called()
