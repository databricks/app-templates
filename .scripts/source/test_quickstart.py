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

import os
from pathlib import Path

import pytest

from quickstart import (
    _replace_lakebase_env_vars,
    update_app_yaml_lakebase,
    update_databricks_yml_experiment,
    update_databricks_yml_lakebase,
)

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

# A databricks.yml with lakebase env vars (like agent-langgraph-short-term-memory)
# Default state: autoscaling active, provisioned commented out
LAKEBASE_YML = """\
bundle:
  name: agent_langgraph_short_term_memory

resources:
  apps:
    agent_langgraph_short_term_memory:
      name: "agent-langgraph-stm"
      description: "LangGraph agent application with short-term memory"
      source_code_path: ./
      config:
        command: ["uv", "run", "start-app"]
        env:
          - name: MLFLOW_EXPERIMENT_ID
            value_from: "experiment"
          # Autoscaling Lakebase config
          - name: LAKEBASE_AUTOSCALING_PROJECT
            value: "<your-project-name>"
          - name: LAKEBASE_AUTOSCALING_BRANCH
            value: "<your-branch-name>"
          # Use for provisioned lakebase resource
          # - name: LAKEBASE_INSTANCE_NAME
          #   value: "<your-lakebase-instance-name>"

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

# Double-quoted variant (like agent-langgraph-long-term-memory)
DOUBLE_QUOTED_YML = """\
bundle:
  name: agent_langgraph_long_term_memory

resources:
  apps:
    agent_langgraph_long_term_memory:
      name: "agent-langgraph-ltm"
      config:
        env:
          - name: MLFLOW_EXPERIMENT_ID
            value_from: "experiment"
          # Autoscaling Lakebase config
          - name: LAKEBASE_AUTOSCALING_PROJECT
            value: "<your-project-name>"
          - name: LAKEBASE_AUTOSCALING_BRANCH
            value: "<your-branch-name>"
          # Use for provisioned lakebase resource
          # - name: LAKEBASE_INSTANCE_NAME
          #   value: "<your-lakebase-instance-name>"

      # Resources which this app has access to
      resources:
        - name: "experiment"
          experiment:
            experiment_id: ""
            permission: "CAN_MANAGE"

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
        assert "LAKEBASE_AUTOSCALING_PROJECT" in content
        assert "LAKEBASE_AUTOSCALING_BRANCH" in content

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
            "agent-langgraph-short-term-memory",
            "agent-langgraph-long-term-memory",
            "agent-openai-agents-sdk",
            "agent-openai-agents-sdk-short-term-memory",
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
        assert "LAKEBASE_AUTOSCALING_PROJECT" not in result
        assert "LAKEBASE_AUTOSCALING_BRANCH" not in result

    def test_provisioned_removes_lakebase_comments(self):
        result = _replace_lakebase_env_vars(
            LAKEBASE_YML, {"type": "provisioned", "instance_name": "my-db"}
        )
        assert "Autoscaling Lakebase config" not in result
        assert "Use for provisioned lakebase resource" not in result

    def test_autoscaling_removes_provisioned_env_var(self):
        result = _replace_lakebase_env_vars(
            LAKEBASE_YML, {"type": "autoscaling", "project": "proj-1", "branch": "production"}
        )
        assert "LAKEBASE_AUTOSCALING_PROJECT" in result
        assert 'value: "proj-1"' in result
        assert "LAKEBASE_AUTOSCALING_BRANCH" in result
        assert 'value: "production"' in result
        assert "LAKEBASE_INSTANCE_NAME" not in result

    def test_autoscaling_removes_lakebase_comments(self):
        result = _replace_lakebase_env_vars(
            LAKEBASE_YML, {"type": "autoscaling", "project": "p", "branch": "b"}
        )
        assert "Autoscaling Lakebase config" not in result
        assert "Use for provisioned lakebase resource" not in result

    def test_preserves_non_lakebase_env_vars(self):
        result = _replace_lakebase_env_vars(
            LAKEBASE_YML, {"type": "provisioned", "instance_name": "x"}
        )
        assert "MLFLOW_EXPERIMENT_ID" in result
        assert 'value_from: "experiment"' in result

    def test_preserves_surrounding_yaml(self):
        result = _replace_lakebase_env_vars(
            LAKEBASE_YML, {"type": "autoscaling", "project": "p", "branch": "b"}
        )
        assert "bundle:" in result
        assert "agent_langgraph_short_term_memory" in result
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
            step1, {"type": "autoscaling", "project": "new-proj", "branch": "dev"}
        )
        assert "LAKEBASE_AUTOSCALING_PROJECT" in step2
        assert 'value: "new-proj"' in step2
        assert "LAKEBASE_AUTOSCALING_BRANCH" in step2
        assert 'value: "dev"' in step2
        assert "LAKEBASE_INSTANCE_NAME" not in step2

    def test_idempotent_autoscaling_to_provisioned(self):
        """Running autoscaling then provisioned should produce clean provisioned output."""
        step1 = _replace_lakebase_env_vars(
            LAKEBASE_YML, {"type": "autoscaling", "project": "p", "branch": "b"}
        )
        step2 = _replace_lakebase_env_vars(
            step1, {"type": "provisioned", "instance_name": "switched-db"}
        )
        assert "LAKEBASE_INSTANCE_NAME" in step2
        assert 'value: "switched-db"' in step2
        assert "LAKEBASE_AUTOSCALING_PROJECT" not in step2
        assert "LAKEBASE_AUTOSCALING_BRANCH" not in step2

    def test_idempotent_same_type_twice(self):
        """Running the same type twice should update values cleanly."""
        step1 = _replace_lakebase_env_vars(
            LAKEBASE_YML, {"type": "autoscaling", "project": "p1", "branch": "b1"}
        )
        step2 = _replace_lakebase_env_vars(
            step1, {"type": "autoscaling", "project": "p2", "branch": "b2"}
        )
        assert 'value: "p2"' in step2
        assert 'value: "b2"' in step2
        assert "p1" not in step2
        assert "b1" not in step2

    def test_double_quoted_yml(self):
        result = _replace_lakebase_env_vars(
            DOUBLE_QUOTED_YML, {"type": "provisioned", "instance_name": "prod-db"}
        )
        assert "LAKEBASE_INSTANCE_NAME" in result
        assert 'value: "prod-db"' in result
        assert "LAKEBASE_AUTOSCALING_PROJECT" not in result


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
            {"type": "autoscaling", "project": "my-proj", "branch": "production"}
        )
        content = (tmp_path / "databricks.yml").read_text()
        assert "LAKEBASE_AUTOSCALING_PROJECT" in content
        assert 'value: "my-proj"' in content
        assert "LAKEBASE_AUTOSCALING_BRANCH" in content
        assert 'value: "production"' in content
        assert "LAKEBASE_INSTANCE_NAME" not in content

    def test_noop_without_lakebase(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(MINIMAL_YML)
        update_databricks_yml_lakebase({"type": "provisioned", "instance_name": "x"})
        content = (tmp_path / "databricks.yml").read_text()
        assert content == MINIMAL_YML

    def test_handles_missing_file(self, tmp_path):
        update_databricks_yml_lakebase({"type": "provisioned", "instance_name": "x"})
        assert not (tmp_path / "databricks.yml").exists()

    def test_against_real_template_files(self, tmp_path):
        """Verify lakebase replacement works on actual template databricks.yml files."""
        repo_root = Path(__file__).resolve().parents[1]
        memory_templates = [
            "agent-langgraph-short-term-memory",
            "agent-langgraph-long-term-memory",
            "agent-openai-agents-sdk-short-term-memory",
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
            assert "LAKEBASE_AUTOSCALING_PROJECT" not in content, (
                f"{template_name}: autoscaling env vars should be removed"
            )
            assert "LAKEBASE_AUTOSCALING_BRANCH" not in content, (
                f"{template_name}: autoscaling env vars should be removed"
            )

            # Test autoscaling
            tdir2 = tmp_path / f"{template_name}-autoscaling"
            tdir2.mkdir()
            (tdir2 / "databricks.yml").write_text(yml_path.read_text())
            os.chdir(tdir2)
            update_databricks_yml_lakebase(
                {"type": "autoscaling", "project": "test-proj", "branch": "test-br"}
            )
            content = (tdir2 / "databricks.yml").read_text()
            assert "LAKEBASE_AUTOSCALING_PROJECT" in content, (
                f"{template_name}: missing LAKEBASE_AUTOSCALING_PROJECT"
            )
            assert 'value: "test-proj"' in content, f"{template_name}: project not set"
            assert 'value: "test-br"' in content, f"{template_name}: branch not set"
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
        update_app_yaml_lakebase({"type": "autoscaling", "project": "p", "branch": "b"})
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
        assert "LAKEBASE_AUTOSCALING_PROJECT" not in content

    def test_experiment_then_autoscaling_lakebase(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(LAKEBASE_YML)
        update_databricks_yml_experiment("54321")
        update_databricks_yml_lakebase(
            {"type": "autoscaling", "project": "my-proj", "branch": "production"}
        )
        content = (tmp_path / "databricks.yml").read_text()
        assert 'experiment_id: "54321"' in content
        assert "LAKEBASE_AUTOSCALING_PROJECT" in content
        assert 'value: "my-proj"' in content
        assert 'value: "production"' in content
        assert "LAKEBASE_INSTANCE_NAME" not in content
