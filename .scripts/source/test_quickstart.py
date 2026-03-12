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
    _replace_lakebase_resource,
    setup_env_file,
    update_app_yaml_lakebase,
    update_databricks_yml_experiment,
    update_databricks_yml_lakebase,
    update_env_file,
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
        # Autoscaling postgres resource must be added via API after deploy
        # See: .claude/skills/add-tools/examples/lakebase-autoscaling.md
        #
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
        # Autoscaling postgres resource must be added via API after deploy
        # See: .claude/skills/add-tools/examples/lakebase-autoscaling.md
        #
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

    def test_provisioned_removes_autoscaling_comments(self):
        result = _replace_lakebase_resource(
            LAKEBASE_YML, {"type": "provisioned", "instance_name": "my-db"}
        )
        assert "Autoscaling postgres resource must be added via API" not in result

    def test_autoscaling_removes_commented_resource(self):
        result = _replace_lakebase_resource(
            LAKEBASE_YML, {"type": "autoscaling", "project": "p", "branch": "b"}
        )
        assert "- name: 'database'" not in result
        assert "# - name: 'database'" not in result
        assert "instance_name:" not in result.replace("instance_name: agent", "")  # ignore bundle name
        assert "Autoscaling postgres resource must be added via API" not in result

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

    def test_noop_autoscaling_without_lakebase_resource(self):
        """Autoscaling on a yml without lakebase resource should be a noop."""
        result = _replace_lakebase_resource(
            MINIMAL_YML, {"type": "autoscaling", "project": "p", "branch": "b"}
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
            step1, {"type": "autoscaling", "project": "p", "branch": "b"}
        )
        assert "- name: 'database'" not in step2

    def test_idempotent_autoscaling_then_provisioned(self):
        """Switching from autoscaling to provisioned should add the database resource."""
        step1 = _replace_lakebase_resource(
            LAKEBASE_YML, {"type": "autoscaling", "project": "p", "branch": "b"}
        )
        assert "- name: 'database'" not in step1
        step2 = _replace_lakebase_resource(
            step1, {"type": "provisioned", "instance_name": "new-db"}
        )
        assert "- name: 'database'" in step2
        assert "instance_name: 'new-db'" in step2

    def test_against_real_template_files(self, tmp_path):
        """Verify resource replacement works on actual template databricks.yml files."""
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
                content, {"type": "autoscaling", "project": "p", "branch": "b"}
            )
            assert "# - name: 'database'" not in result2, f"{template_name}: commented resource should be removed"
            # Make sure we didn't add an uncommented one either
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
            {"type": "autoscaling", "project": "my-proj", "branch": "production"}
        )
        content = (tmp_path / "databricks.yml").read_text()
        assert "LAKEBASE_AUTOSCALING_PROJECT" in content
        assert 'value: "my-proj"' in content
        assert "LAKEBASE_AUTOSCALING_BRANCH" in content
        assert 'value: "production"' in content
        assert "LAKEBASE_INSTANCE_NAME" not in content

    def test_noop_autoscaling_without_lakebase(self, tmp_path):
        """Autoscaling on a yml without lakebase env vars should be a noop."""
        (tmp_path / "databricks.yml").write_text(MINIMAL_YML)
        update_databricks_yml_lakebase({"type": "autoscaling", "project": "p", "branch": "b"})
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
        "agent-langgraph-short-term-memory",
        "agent-langgraph-long-term-memory",
        "agent-openai-agents-sdk-short-term-memory",
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
            update_env_file("PGHOST", "instance-abc.database.staging.cloud.databricks.com")
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
        "agent-langgraph-short-term-memory",
        "agent-langgraph-long-term-memory",
        "agent-openai-agents-sdk-short-term-memory",
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
            update_env_file("LAKEBASE_AUTOSCALING_PROJECT", "j-autoscaling7")
            update_env_file("LAKEBASE_AUTOSCALING_BRANCH", "production")
            update_env_file("LAKEBASE_INSTANCE_NAME", "")
            update_env_file("PGUSER", "test@databricks.com")
            update_env_file("PGDATABASE", "databricks_postgres")

            # Step 4: Set autoscaling lakebase in databricks.yml
            update_databricks_yml_lakebase(
                {"type": "autoscaling", "project": "j-autoscaling7", "branch": "production"}
            )

            # Verify .env
            env_content = (tdir / ".env").read_text()
            assert "LAKEBASE_AUTOSCALING_PROJECT=j-autoscaling7" in env_content, (
                f"{template_name}: .env missing LAKEBASE_AUTOSCALING_PROJECT"
            )
            assert "LAKEBASE_AUTOSCALING_BRANCH=production" in env_content, (
                f"{template_name}: .env missing LAKEBASE_AUTOSCALING_BRANCH"
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
            assert "LAKEBASE_AUTOSCALING_PROJECT" in yml_content, (
                f"{template_name}: databricks.yml missing LAKEBASE_AUTOSCALING_PROJECT"
            )
            assert 'value: "j-autoscaling7"' in yml_content, (
                f"{template_name}: databricks.yml missing project value"
            )
            assert "LAKEBASE_AUTOSCALING_BRANCH" in yml_content, (
                f"{template_name}: databricks.yml missing LAKEBASE_AUTOSCALING_BRANCH"
            )
            assert 'value: "production"' in yml_content, (
                f"{template_name}: databricks.yml missing branch value"
            )
            assert "LAKEBASE_INSTANCE_NAME" not in yml_content, (
                f"{template_name}: databricks.yml should not have provisioned instance name"
            )
            # Should NOT have database resource (autoscaling uses API)
            lines_with_database = [
                l
                for l in yml_content.splitlines()
                if "- name:" in l and "database" in l
            ]
            assert len(lines_with_database) == 0, (
                f"{template_name}: databricks.yml should not have database resource"
            )
