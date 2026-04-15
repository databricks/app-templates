# Quickstart script functionality:
# 1. Checks prerequisites (uv, node, npm, databricks CLI) and validates Node.js version
# 2. Creates .env from .env.example (or from scratch)
# 3. Sets up Databricks authentication (validates/creates profile)
# 4. Gets Databricks username via current-user API
# 5. Creates MLflow experiment via `databricks experiments create-experiment`
# 6. Updates .env with: DATABRICKS_CONFIG_PROFILE, MLFLOW_TRACKING_URI, MLFLOW_EXPERIMENT_ID
# 7. Updates databricks.yml: sets experiment_id in app resource
# 8. (If lakebase needed) Sets up lakebase (provisioned or autoscaling)
# 9. (If lakebase needed) Updates databricks.yml: keeps only relevant lakebase env vars, removes the others
# 10. (If lakebase needed) Updates .env with LAKEBASE_INSTANCE_NAME or LAKEBASE_AUTOSCALING_PROJECT + BRANCH

import json
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from quickstart import (
    _replace_lakebase_env_vars,
    _replace_lakebase_resource,
    create_mlflow_experiment,
    get_databricks_yml_experiment_id,
    get_existing_lakebase_config,
    setup_env_file,
    update_app_yaml_lakebase,
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
# Default state: autoscaling active, provisioned commented out
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
          # Use for provisioned lakebase resource
          # - name: LAKEBASE_INSTANCE_NAME
          #   value: "<your-lakebase-instance-name>"

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
        # Use for provisioned lakebase resource
        # - name: 'database'
        #   database:
        #     instance_name: '<your-lakebase-instance-name>'
        #     database_name: 'databricks_postgres'
        #     permission: 'CAN_CONNECT_AND_CREATE'

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
          # Use for provisioned lakebase resource
          # - name: LAKEBASE_INSTANCE_NAME
          #   value: "<your-lakebase-instance-name>"

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
        # Use for provisioned lakebase resource
        # - name: "database"
        #   database:
        #     instance_name: "<your-lakebase-instance-name>"
        #     database_name: "databricks_postgres"
        #     permission: "CAN_CONNECT_AND_CREATE"

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

    def test_provisioned_removes_autoscaling_env_vars(self):
        result = _replace_lakebase_env_vars(
            LAKEBASE_YML, {"type": "provisioned", "instance_name": "my-db"}
        )
        assert "LAKEBASE_INSTANCE_NAME" in result
        assert 'value: "my-db"' in result
        assert "LAKEBASE_AUTOSCALING_ENDPOINT" not in result

    def test_provisioned_removes_lakebase_comments(self):
        result = _replace_lakebase_env_vars(
            LAKEBASE_YML, {"type": "provisioned", "instance_name": "my-db"}
        )
        assert "Use for provisioned lakebase resource" not in result

    def test_autoscaling_removes_provisioned_env_var(self):
        result = _replace_lakebase_env_vars(
            LAKEBASE_YML, {"type": "autoscaling", "endpoint": "my-endpoint"}
        )
        assert "LAKEBASE_AUTOSCALING_ENDPOINT" in result
        assert 'value_from: "postgres"' in result
        assert "LAKEBASE_INSTANCE_NAME" not in result

    def test_autoscaling_removes_lakebase_comments(self):
        result = _replace_lakebase_env_vars(
            LAKEBASE_YML, {"type": "autoscaling", "endpoint": "ep"}
        )
        assert "Use for provisioned lakebase resource" not in result

    def test_preserves_non_lakebase_env_vars(self):
        result = _replace_lakebase_env_vars(
            LAKEBASE_YML, {"type": "provisioned", "instance_name": "x"}
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
            MINIMAL_YML, {"type": "provisioned", "instance_name": "x"}
        )
        assert result == MINIMAL_YML

    def test_indent_matches_existing_env_vars(self):
        result = _replace_lakebase_env_vars(
            LAKEBASE_YML, {"type": "provisioned", "instance_name": "my-db"}
        )
        # The LAKEBASE env var should be at the same indent as MLFLOW_EXPERIMENT_ID
        for line in result.splitlines():
            if "- name: LAKEBASE_INSTANCE_NAME" in line:
                lakebase_indent = len(line) - len(line.lstrip())
            if "- name: MLFLOW_EXPERIMENT_ID" in line:
                mlflow_indent = len(line) - len(line.lstrip())
        assert lakebase_indent == mlflow_indent

    def test_idempotent_provisioned_to_autoscaling(self):
        """Running provisioned then autoscaling should produce clean autoscaling output."""
        step1 = _replace_lakebase_env_vars(
            LAKEBASE_YML, {"type": "provisioned", "instance_name": "my-db"}
        )
        step2 = _replace_lakebase_env_vars(
            step1, {"type": "autoscaling", "endpoint": "new-ep"}
        )
        assert "LAKEBASE_AUTOSCALING_ENDPOINT" in step2
        assert 'value_from: "postgres"' in step2
        assert "LAKEBASE_INSTANCE_NAME" not in step2

    def test_idempotent_autoscaling_to_provisioned(self):
        """Running autoscaling then provisioned should produce clean provisioned output."""
        step1 = _replace_lakebase_env_vars(
            LAKEBASE_YML, {"type": "autoscaling", "endpoint": "ep"}
        )
        step2 = _replace_lakebase_env_vars(
            step1, {"type": "provisioned", "instance_name": "switched-db"}
        )
        assert "LAKEBASE_INSTANCE_NAME" in step2
        assert 'value: "switched-db"' in step2
        assert "LAKEBASE_AUTOSCALING_ENDPOINT" not in step2

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
            DOUBLE_QUOTED_YML, {"type": "provisioned", "instance_name": "prod-db"}
        )
        assert "LAKEBASE_INSTANCE_NAME" in result
        assert 'value: "prod-db"' in result
        assert "LAKEBASE_AUTOSCALING_ENDPOINT" not in result


class TestReplaceLakebaseResource:
    """Tests for _replace_lakebase_resource helper (database resource section)."""

    def test_provisioned_uncomments_database_resource(self):
        result = _replace_lakebase_resource(
            LAKEBASE_YML, {"type": "provisioned", "instance_name": "my-db"}
        )
        assert "- name: 'database'" in result
        assert "instance_name: 'my-db'" in result
        assert "database_name: 'databricks_postgres'" in result
        assert "permission: 'CAN_CONNECT_AND_CREATE'" in result
        # Should not have commented-out resource
        assert "# - name: 'database'" not in result

    def test_autoscaling_removes_commented_resource(self):
        result = _replace_lakebase_resource(
            LAKEBASE_YML, {"type": "autoscaling", "endpoint": "my-ep"}
        )
        assert "- name: 'database'" not in result
        assert "# - name: 'database'" not in result
        assert "instance_name:" not in result.replace("instance_name: agent", "")  # ignore bundle name

    def test_preserves_experiment_resource(self):
        result = _replace_lakebase_resource(
            LAKEBASE_YML, {"type": "provisioned", "instance_name": "my-db"}
        )
        assert "- name: 'experiment'" in result
        assert "experiment_id:" in result
        assert "permission: 'CAN_MANAGE'" in result

    def test_preserves_non_resource_content(self):
        result = _replace_lakebase_resource(
            LAKEBASE_YML, {"type": "provisioned", "instance_name": "x"}
        )
        assert "bundle:" in result
        assert "targets:" in result
        assert "mode: development" in result

    def test_adds_resource_to_yml_without_lakebase_section(self):
        """If no lakebase resource section exists, provisioned should add one."""
        result = _replace_lakebase_resource(
            MINIMAL_YML, {"type": "provisioned", "instance_name": "x"}
        )
        assert "- name: 'database'" in result
        assert "instance_name: 'x'" in result

    def test_autoscaling_fills_endpoint(self):
        result = _replace_lakebase_resource(
            LAKEBASE_YML, {"type": "autoscaling", "endpoint": "my-ep"}
        )
        assert "- name: 'postgres'" in result
        assert 'endpoint: "my-ep"' in result
        assert "permission: 'CAN_CONNECT_AND_CREATE'" in result

    def test_noop_autoscaling_without_lakebase_resource(self):
        """Autoscaling on a yml without lakebase resource should be a noop."""
        result = _replace_lakebase_resource(
            MINIMAL_YML, {"type": "autoscaling", "endpoint": "ep"}
        )
        assert result == MINIMAL_YML

    def test_idempotent_provisioned_twice(self):
        """Running provisioned twice should update the instance name."""
        step1 = _replace_lakebase_resource(
            LAKEBASE_YML, {"type": "provisioned", "instance_name": "db-1"}
        )
        step2 = _replace_lakebase_resource(
            step1, {"type": "provisioned", "instance_name": "db-2"}
        )
        assert "instance_name: 'db-2'" in step2
        assert "db-1" not in step2

    def test_idempotent_provisioned_then_autoscaling(self):
        """Switching from provisioned to autoscaling should remove the database resource."""
        step1 = _replace_lakebase_resource(
            LAKEBASE_YML, {"type": "provisioned", "instance_name": "my-db"}
        )
        assert "- name: 'database'" in step1
        step2 = _replace_lakebase_resource(
            step1, {"type": "autoscaling", "endpoint": "my-ep"}
        )
        assert "- name: 'database'" not in step2
        assert "- name: 'postgres'" in step2
        assert 'endpoint: "my-ep"' in step2

    def test_idempotent_autoscaling_then_provisioned(self):
        """Switching from autoscaling to provisioned should add the database resource."""
        step1 = _replace_lakebase_resource(
            LAKEBASE_YML, {"type": "autoscaling", "endpoint": "ep"}
        )
        assert "- name: 'database'" not in step1
        step2 = _replace_lakebase_resource(
            step1, {"type": "provisioned", "instance_name": "new-db"}
        )
        assert "- name: 'database'" in step2
        assert "instance_name: 'new-db'" in step2

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

            # Test provisioned
            result = _replace_lakebase_resource(
                content, {"type": "provisioned", "instance_name": "test-db"}
            )
            assert "- name: 'database'" in result, f"{template_name}: database resource not added"
            assert "instance_name: 'test-db'" in result, f"{template_name}: instance name not set"
            assert "# - name: 'database'" not in result, f"{template_name}: commented resource should be removed"

            # Test autoscaling
            result2 = _replace_lakebase_resource(
                content, {"type": "autoscaling", "endpoint": "test-ep"}
            )
            assert "# - name: 'database'" not in result2, f"{template_name}: commented resource should be removed"
            assert 'endpoint: "test-ep"' in result2, f"{template_name}: endpoint not set in postgres resource"
            # Make sure we didn't add an uncommented database resource
            lines_with_database = [l for l in result2.splitlines() if "- name:" in l and "database" in l]
            assert len(lines_with_database) == 0, f"{template_name}: database resource should not exist for autoscaling"


class TestUpdateDatabricksYmlLakebase:
    def test_provisioned_updates_file(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(LAKEBASE_YML)
        update_databricks_yml_lakebase({"type": "provisioned", "instance_name": "my-instance"})
        content = (tmp_path / "databricks.yml").read_text()
        assert "LAKEBASE_INSTANCE_NAME" in content
        assert 'value: "my-instance"' in content
        assert "LAKEBASE_AUTOSCALING_PROJECT" not in content

    def test_autoscaling_updates_file(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(LAKEBASE_YML)
        update_databricks_yml_lakebase(
            {"type": "autoscaling", "endpoint": "my-endpoint"}
        )
        content = (tmp_path / "databricks.yml").read_text()
        assert "LAKEBASE_AUTOSCALING_ENDPOINT" in content
        assert 'value_from: "postgres"' in content
        assert 'endpoint: "my-endpoint"' in content
        assert "LAKEBASE_INSTANCE_NAME" not in content

    def test_noop_autoscaling_without_lakebase(self, tmp_path):
        """Autoscaling on a yml without lakebase env vars should be a noop."""
        (tmp_path / "databricks.yml").write_text(MINIMAL_YML)
        update_databricks_yml_lakebase({"type": "autoscaling", "endpoint": "ep"})
        content = (tmp_path / "databricks.yml").read_text()
        assert content == MINIMAL_YML

    def test_handles_missing_file(self, tmp_path):
        update_databricks_yml_lakebase({"type": "provisioned", "instance_name": "x"})
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

            # Test provisioned
            tdir = tmp_path / f"{template_name}-provisioned"
            tdir.mkdir()
            (tdir / "databricks.yml").write_text(yml_path.read_text())
            os.chdir(tdir)
            update_databricks_yml_lakebase({"type": "provisioned", "instance_name": "test-db"})
            content = (tdir / "databricks.yml").read_text()
            assert "LAKEBASE_INSTANCE_NAME" in content, f"{template_name}: missing LAKEBASE_INSTANCE_NAME"
            assert 'value: "test-db"' in content, f"{template_name}: instance name not set"
            assert "LAKEBASE_AUTOSCALING_ENDPOINT" not in content, (
                f"{template_name}: autoscaling env vars should be removed"
            )

            # Test autoscaling
            tdir2 = tmp_path / f"{template_name}-autoscaling"
            tdir2.mkdir()
            (tdir2 / "databricks.yml").write_text(yml_path.read_text())
            os.chdir(tdir2)
            update_databricks_yml_lakebase(
                {"type": "autoscaling", "endpoint": "test-ep"}
            )
            content = (tdir2 / "databricks.yml").read_text()
            assert "LAKEBASE_AUTOSCALING_ENDPOINT" in content, (
                f"{template_name}: missing LAKEBASE_AUTOSCALING_ENDPOINT"
            )
            assert 'value_from: "postgres"' in content, f"{template_name}: value_from not set"
            assert 'endpoint: "test-ep"' in content, f"{template_name}: endpoint not set"
            assert "LAKEBASE_INSTANCE_NAME" not in content, (
                f"{template_name}: provisioned env var should be removed"
            )


class TestUpdateAppYamlLakebase:
    def test_provisioned_updates_file(self, tmp_path):
        (tmp_path / "app.yaml").write_text(LAKEBASE_YML)  # reuse as stand-in
        update_app_yaml_lakebase({"type": "provisioned", "instance_name": "my-instance"})
        content = (tmp_path / "app.yaml").read_text()
        assert "LAKEBASE_INSTANCE_NAME" in content
        assert "LAKEBASE_AUTOSCALING_PROJECT" not in content

    def test_handles_missing_file(self, tmp_path):
        update_app_yaml_lakebase({"type": "provisioned", "instance_name": "x"})
        assert not (tmp_path / "app.yaml").exists()

    def test_noop_without_lakebase(self, tmp_path):
        (tmp_path / "app.yaml").write_text(MINIMAL_YML)
        update_app_yaml_lakebase({"type": "autoscaling", "endpoint": "ep"})
        content = (tmp_path / "app.yaml").read_text()
        assert content == MINIMAL_YML


class TestCombined:
    def test_experiment_then_provisioned_lakebase(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(LAKEBASE_YML)
        update_databricks_yml_experiment("54321")
        update_databricks_yml_lakebase({"type": "provisioned", "instance_name": "prod-db"})
        content = (tmp_path / "databricks.yml").read_text()
        assert 'experiment_id: "54321"' in content
        assert "LAKEBASE_INSTANCE_NAME" in content
        assert 'value: "prod-db"' in content
        assert "LAKEBASE_AUTOSCALING_ENDPOINT" not in content

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
            "# Option 1: Provisioned\n# LAKEBASE_INSTANCE_NAME=\nOTHER=yes\n"
        )
        update_env_file("LAKEBASE_INSTANCE_NAME", "my-db")
        content = (tmp_path / ".env").read_text()
        assert "LAKEBASE_INSTANCE_NAME=my-db" in content
        assert "# LAKEBASE_INSTANCE_NAME=" not in content
        assert "OTHER=yes" in content
        # Should not be appended at the end (replaced in-place)
        lines = content.strip().split("\n")
        assert lines[1] == "LAKEBASE_INSTANCE_NAME=my-db"

    def test_replaces_commented_out_key_with_space(self, tmp_path):
        (tmp_path / ".env").write_text("# LAKEBASE_AUTOSCALING_PROJECT=\n")
        update_env_file("LAKEBASE_AUTOSCALING_PROJECT", "my-proj")
        content = (tmp_path / ".env").read_text()
        assert "LAKEBASE_AUTOSCALING_PROJECT=my-proj" in content
        assert content.count("LAKEBASE_AUTOSCALING_PROJECT") == 1

    def test_active_line_removes_leftover_commented_line(self, tmp_path):
        """When an active line exists alongside a commented-out version, the
        commented version should be cleaned up."""
        (tmp_path / ".env").write_text(
            "# LAKEBASE_INSTANCE_NAME=\n"
            "OTHER=yes\n"
            "LAKEBASE_INSTANCE_NAME=old-db\n"
        )
        update_env_file("LAKEBASE_INSTANCE_NAME", "new-db")
        content = (tmp_path / ".env").read_text()
        assert "LAKEBASE_INSTANCE_NAME=new-db" in content
        assert "# LAKEBASE_INSTANCE_NAME=" not in content
        assert content.count("LAKEBASE_INSTANCE_NAME") == 1
        assert "OTHER=yes" in content

    def test_full_env_example_scenario(self, tmp_path):
        """Simulates .env from .env.example with commented lakebase vars
        plus active lines from a previous quickstart run."""
        (tmp_path / ".env").write_text(
            "# TODO: Update with your Lakebase instance\n"
            "# Option 1: Provisioned instance (set instance name)\n"
            "# LAKEBASE_INSTANCE_NAME=\n"
            "# Option 2: Autoscaling endpoint name\n"
            "# LAKEBASE_AUTOSCALING_ENDPOINT=\n"
            "\n"
            "CHAT_APP_PORT=3000\n"
            "LAKEBASE_INSTANCE_NAME=\n"
            "LAKEBASE_AUTOSCALING_ENDPOINT=old-ep\n"
        )
        # Simulate autoscaling quickstart
        update_env_file("LAKEBASE_AUTOSCALING_ENDPOINT", "new-ep")
        update_env_file("LAKEBASE_INSTANCE_NAME", "")
        content = (tmp_path / ".env").read_text()
        assert content.count("LAKEBASE_AUTOSCALING_ENDPOINT") == 1
        assert content.count("LAKEBASE_INSTANCE_NAME") == 1
        assert "LAKEBASE_AUTOSCALING_ENDPOINT=new-ep" in content
        assert "# LAKEBASE_INSTANCE_NAME=" not in content
        assert "# LAKEBASE_AUTOSCALING_ENDPOINT=" not in content
        assert "CHAT_APP_PORT=3000" in content
        # Values should be in the TODO section, not appended at the bottom
        lines = content.strip().split("\n")
        lakebase_idx = next(i for i, l in enumerate(lines) if l.startswith("LAKEBASE_INSTANCE_NAME="))
        chat_idx = next(i for i, l in enumerate(lines) if l.startswith("CHAT_APP_PORT="))
        assert lakebase_idx < chat_idx, "Lakebase vars should be in the TODO section, not appended after CHAT_APP_PORT"

    def test_fresh_env_example_autoscaling(self, tmp_path):
        """First quickstart run on a fresh .env copied from .env.example."""
        (tmp_path / ".env").write_text(
            "# TODO: Update with your Lakebase instance\n"
            "# Option 1: Provisioned instance (set instance name)\n"
            "# LAKEBASE_INSTANCE_NAME=\n"
            "# Option 2: Autoscaling endpoint name\n"
            "# LAKEBASE_AUTOSCALING_ENDPOINT=\n"
            "\n"
            "CHAT_APP_PORT=3000\n"
        )
        update_env_file("LAKEBASE_AUTOSCALING_ENDPOINT", "my-ep")
        update_env_file("LAKEBASE_INSTANCE_NAME", "")
        content = (tmp_path / ".env").read_text()
        # Both should appear in-place where the commented lines were
        lines = content.strip().split("\n")
        assert "LAKEBASE_INSTANCE_NAME=" in lines
        assert "LAKEBASE_AUTOSCALING_ENDPOINT=my-ep" in lines
        # Should be before CHAT_APP_PORT, not appended
        inst_idx = lines.index("LAKEBASE_INSTANCE_NAME=")
        ep_idx = lines.index("LAKEBASE_AUTOSCALING_ENDPOINT=my-ep")
        chat_idx = lines.index("CHAT_APP_PORT=3000")
        assert inst_idx < chat_idx
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


class TestHappyPathProvisionedOnRealTemplates:
    """End-to-end happy path: provisioned Lakebase on real template files.

    Simulates what quickstart does: copy .env.example -> .env, set experiment,
    set lakebase config, and verify both .env and databricks.yml are correct.
    """

    MEMORY_TEMPLATES = [
        "agent-langgraph-advanced",
        "agent-openai-advanced",
    ]

    def test_provisioned_happy_path(self, tmp_path):
        repo_root = Path(__file__).resolve().parents[1]

        for template_name in self.MEMORY_TEMPLATES:
            template_dir = repo_root / template_name
            if not template_dir.exists():
                continue

            # Set up working directory
            tdir = tmp_path / f"{template_name}-provisioned"
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
            update_databricks_yml_experiment("12345")

            # Step 3: Set provisioned lakebase in .env
            update_env_file("LAKEBASE_INSTANCE_NAME", "my-provisioned-db")
            update_env_file("LAKEBASE_AUTOSCALING_PROJECT", "")
            update_env_file("LAKEBASE_AUTOSCALING_BRANCH", "")
            update_env_file("PGHOST", "instance-abc.database.cloud.databricks.com")
            update_env_file("PGUSER", "test@databricks.com")
            update_env_file("PGDATABASE", "databricks_postgres")

            # Step 4: Set provisioned lakebase in databricks.yml
            update_databricks_yml_lakebase(
                {"type": "provisioned", "instance_name": "my-provisioned-db"}
            )

            # Verify .env
            env_content = (tdir / ".env").read_text()
            assert "LAKEBASE_INSTANCE_NAME=my-provisioned-db" in env_content, (
                f"{template_name}: .env missing LAKEBASE_INSTANCE_NAME"
            )
            assert "PGHOST=instance-abc" in env_content, (
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
            assert 'experiment_id: "12345"' in yml_content, (
                f"{template_name}: databricks.yml missing experiment_id"
            )
            assert "LAKEBASE_INSTANCE_NAME" in yml_content, (
                f"{template_name}: databricks.yml missing LAKEBASE_INSTANCE_NAME"
            )
            assert 'value: "my-provisioned-db"' in yml_content, (
                f"{template_name}: databricks.yml missing instance name value"
            )
            assert "LAKEBASE_AUTOSCALING_PROJECT" not in yml_content, (
                f"{template_name}: databricks.yml should not have autoscaling project"
            )
            assert "LAKEBASE_AUTOSCALING_BRANCH" not in yml_content, (
                f"{template_name}: databricks.yml should not have autoscaling branch"
            )
            # Should have database resource
            assert "- name: 'database'" in yml_content, (
                f"{template_name}: databricks.yml missing database resource"
            )
            assert "instance_name: 'my-provisioned-db'" in yml_content, (
                f"{template_name}: databricks.yml missing instance_name in resource"
            )


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


def _mock_workspace_client(get_experiment_result=None, get_experiment_raises=False,
                            create_experiment_id="99999"):
    """Build a mock WorkspaceClient for experiment tests."""
    mock_w = MagicMock()
    if get_experiment_raises:
        mock_w.experiments.get_experiment.side_effect = Exception("not found")
    else:
        mock_exp = MagicMock()
        mock_exp.experiment = get_experiment_result
        mock_w.experiments.get_experiment.return_value = mock_exp
    mock_create = MagicMock()
    mock_create.experiment_id = create_experiment_id
    mock_w.experiments.create_experiment.return_value = mock_create
    return mock_w


class TestExperimentIdempotency:
    """Tests for experiment reuse logic in create_mlflow_experiment."""

    def test_reuses_existing_id_in_env(self, tmp_path):
        """When .env has a valid experiment ID, returns it without creating a new one."""
        (tmp_path / ".env").write_text("MLFLOW_EXPERIMENT_ID=12345\n")
        existing_exp = MagicMock(name_="/Users/test/agents-on-apps", experiment_id="12345")
        existing_exp.name = "/Users/test/agents-on-apps"
        mock_w = _mock_workspace_client(get_experiment_result=existing_exp)
        with patch("quickstart.get_workspace_client", return_value=mock_w):
            name, exp_id = create_mlflow_experiment("DEFAULT", "test@example.com")

        assert exp_id == "12345"
        assert name == "/Users/test/agents-on-apps"
        mock_w.experiments.get_experiment.assert_called_once_with(experiment_id="12345")
        mock_w.experiments.create_experiment.assert_not_called()

    def test_creates_new_if_id_missing(self, tmp_path):
        """When .env has no MLFLOW_EXPERIMENT_ID, creates a new experiment."""
        (tmp_path / ".env").write_text("DATABRICKS_CONFIG_PROFILE=DEFAULT\n")
        mock_w = _mock_workspace_client(create_experiment_id="99999")
        with patch("quickstart.get_workspace_client", return_value=mock_w):
            name, exp_id = create_mlflow_experiment("DEFAULT", "test@example.com")

        assert exp_id == "99999"
        mock_w.experiments.get_experiment.assert_not_called()
        mock_w.experiments.create_experiment.assert_called_once()

    def test_creates_new_if_experiment_deleted(self, tmp_path):
        """When .env has ID but get_experiment fails, creates a new experiment."""
        (tmp_path / ".env").write_text("MLFLOW_EXPERIMENT_ID=deleted-id\n")
        mock_w = _mock_workspace_client(get_experiment_raises=True, create_experiment_id="new-id")
        with patch("quickstart.get_workspace_client", return_value=mock_w):
            name, exp_id = create_mlflow_experiment("DEFAULT", "test@example.com")

        assert exp_id == "new-id"
        mock_w.experiments.create_experiment.assert_called_once()

    def test_still_updates_yml_on_reuse(self, tmp_path):
        """Even when reusing an experiment, databricks.yml gets the experiment_id set."""
        (tmp_path / "databricks.yml").write_text(MINIMAL_YML)
        (tmp_path / ".env").write_text("MLFLOW_EXPERIMENT_ID=12345\n")
        existing_exp = MagicMock()
        existing_exp.name = "/Users/test/agents-on-apps"
        mock_w = _mock_workspace_client(get_experiment_result=existing_exp)
        with patch("quickstart.get_workspace_client", return_value=mock_w):
            _, exp_id = create_mlflow_experiment("DEFAULT", "test@example.com")

        # The test verifies create_mlflow_experiment returns the ID correctly;
        # the caller (main) is responsible for calling update_databricks_yml_experiment
        assert exp_id == "12345"
        # Explicitly verify update_databricks_yml_experiment works after reuse
        update_databricks_yml_experiment(exp_id)
        content = (tmp_path / "databricks.yml").read_text()
        assert 'experiment_id: "12345"' in content


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

    def test_detects_existing_provisioned_config(self, tmp_path):
        (tmp_path / ".env").write_text("LAKEBASE_INSTANCE_NAME=my-instance\n")
        result = get_existing_lakebase_config()
        assert result == {"type": "provisioned", "instance_name": "my-instance"}

    def test_returns_none_when_not_configured(self, tmp_path):
        (tmp_path / ".env").write_text("DATABRICKS_CONFIG_PROFILE=DEFAULT\n")
        result = get_existing_lakebase_config()
        assert result is None

    def test_returns_none_when_no_env_file(self, tmp_path):
        result = get_existing_lakebase_config()
        assert result is None

    def test_autoscaling_takes_priority_over_provisioned(self, tmp_path):
        """When both are set, autoscaling takes priority."""
        (tmp_path / ".env").write_text(
            "LAKEBASE_AUTOSCALING_ENDPOINT=ep\n"
            "LAKEBASE_INSTANCE_NAME=inst\n"
        )
        result = get_existing_lakebase_config()
        assert result is not None
        assert result["type"] == "autoscaling"


class TestLakebaseForNonMemoryTemplate:
    """Tests that Lakebase setup works on non-memory templates (for UI chat history)."""

    def test_provisioned_adds_database_resource_to_minimal_yml(self):
        result = _replace_lakebase_resource(
            MINIMAL_YML, {"type": "provisioned", "instance_name": "mydb"}
        )
        assert "- name: 'database'" in result
        assert "instance_name: 'mydb'" in result
        assert "database_name: 'databricks_postgres'" in result

    def test_autoscaling_noop_on_minimal_yml(self):
        result = _replace_lakebase_resource(
            MINIMAL_YML, {"type": "autoscaling", "endpoint": "ep"}
        )
        assert result == MINIMAL_YML

    def test_env_vars_noop_on_minimal_yml(self):
        """Non-memory templates have no LAKEBASE_ env vars in databricks.yml — noop."""
        result = _replace_lakebase_env_vars(
            MINIMAL_YML, {"type": "provisioned", "instance_name": "mydb"}
        )
        assert result == MINIMAL_YML

    def test_against_real_non_memory_templates(self, tmp_path):
        """Provisioned Lakebase can be added to real non-memory template databricks.yml."""
        repo_root = Path(__file__).resolve().parents[1]
        non_memory_templates = [
            "agent-langgraph",
            "agent-openai-agents-sdk",
            "agent-non-conversational",
        ]
        for template_name in non_memory_templates:
            yml_path = repo_root / template_name / "databricks.yml"
            if not yml_path.exists():
                continue
            tdir = tmp_path / template_name
            tdir.mkdir()
            (tdir / "databricks.yml").write_text(yml_path.read_text())
            os.chdir(tdir)

            update_databricks_yml_lakebase({"type": "provisioned", "instance_name": "ui-db"})
            content = (tdir / "databricks.yml").read_text()
            assert "- name: 'database'" in content, (
                f"{template_name}: database resource not added"
            )
            assert "instance_name: 'ui-db'" in content, (
                f"{template_name}: instance name not set"
            )


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

    def test_provisioned_valid(self):
        config = {"type": "provisioned", "instance_name": "my-db"}
        with patch("quickstart.validate_lakebase_instance", return_value={"read_write_dns": "host"}):
            assert validate_lakebase_config("DEFAULT", config) is True

    def test_provisioned_invalid(self):
        config = {"type": "provisioned", "instance_name": "missing-db"}
        with patch("quickstart.validate_lakebase_instance", return_value=None):
            assert validate_lakebase_config("DEFAULT", config) is False

    def test_autoscaling_valid(self):
        config = {"type": "autoscaling", "endpoint": "my-ep"}
        with patch("quickstart.validate_lakebase_autoscaling_endpoint", return_value={"endpoint": "my-ep"}):
            assert validate_lakebase_config("DEFAULT", config) is True

    def test_autoscaling_invalid(self):
        config = {"type": "autoscaling", "endpoint": "missing-ep"}
        with patch("quickstart.validate_lakebase_autoscaling_endpoint", return_value=None):
            assert validate_lakebase_config("DEFAULT", config) is False

    def test_provisioned_calls_correct_validator(self):
        config = {"type": "provisioned", "instance_name": "my-db"}
        with patch("quickstart.validate_lakebase_instance", return_value={}) as mock_validate:
            validate_lakebase_config("my-profile", config)
        mock_validate.assert_called_once_with("my-profile", "my-db")

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

REQUIRED_ENV_VARS_PROVISIONED = [
    "MLFLOW_EXPERIMENT_ID",
    "LAKEBASE_INSTANCE_NAME",
    "PGHOST",
    "PGUSER",
]


class TestRequiredEnvVarsContract:
    """Verifies that all required env vars are populated after quickstart completes.

    Every quickstart path (autoscaling, provisioned, app-bind) must set:
    - MLFLOW_EXPERIMENT_ID
    - PGHOST
    - PGUSER
    - Either LAKEBASE_AUTOSCALING_ENDPOINT or LAKEBASE_INSTANCE_NAME
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

    def test_provisioned_sets_all_required_env_vars(self, tmp_path):
        for template_name in self.MEMORY_TEMPLATES:
            tdir = self._setup_env(tmp_path / "prov", template_name)
            update_databricks_yml_experiment("12345")
            update_env_file("MLFLOW_EXPERIMENT_ID", "12345")
            update_env_file("LAKEBASE_INSTANCE_NAME", "my-db")
            update_env_file("LAKEBASE_AUTOSCALING_ENDPOINT", "")
            update_env_file("PGHOST", "instance-abc.database.cloud.databricks.com")
            update_env_file("PGUSER", "user@databricks.com")
            self._assert_env_has_vars(
                tdir, REQUIRED_ENV_VARS_PROVISIONED, template_name, "provisioned"
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

    def test_app_bind_provisioned_sets_all_required_env_vars(self, tmp_path):
        """Simulates what happens when quickstart binds to an existing app with database."""
        for template_name in self.MEMORY_TEMPLATES:
            tdir = self._setup_env(tmp_path / "app-prov", template_name)
            update_env_file("MLFLOW_EXPERIMENT_ID", "99999")
            update_env_file("LAKEBASE_INSTANCE_NAME", "my-provisioned-db")
            update_env_file("LAKEBASE_AUTOSCALING_ENDPOINT", "")
            update_env_file("PGHOST", "instance-abc.database.cloud.databricks.com")
            update_env_file("PGUSER", "user@databricks.com")
            self._assert_env_has_vars(
                tdir, REQUIRED_ENV_VARS_PROVISIONED, template_name, "app-bind provisioned"
            )
