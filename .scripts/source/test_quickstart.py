# Quickstart script functionality:
# 1. Checks prerequisites (uv, node, npm, databricks CLI) and validates Node.js version
# 2. Creates .env from .env.example (or from scratch)
# 3. Sets up Databricks authentication (validates/creates profile)
# 4. Gets Databricks username via current-user API
# 5. Creates MLflow experiment via `databricks experiments create-experiment`
# 6. Updates .env with: DATABRICKS_CONFIG_PROFILE, MLFLOW_TRACKING_URI, MLFLOW_EXPERIMENT_ID
# 7. Updates databricks.yml: removes DAB experiment resource, sets MLFLOW_EXPERIMENT_ID to literal value
# 8. (If lakebase needed) Validates lakebase instance, updates .env with LAKEBASE_INSTANCE_NAME, PGHOST, PGUSER, PGDATABASE
# 9. (If lakebase needed) Updates databricks.yml: replaces <your-lakebase-instance-name> placeholder

import os
from pathlib import Path

import pytest

from quickstart import update_databricks_yml_experiment, update_databricks_yml_lakebase

# A minimal databricks.yml with experiment resource only (like agent-langgraph)
MINIMAL_YML = """\
bundle:
  name: agent_langgraph

resources:
  # MLflow experiment for agent tracing - automatically created by bundle
  experiments:
    agent_langgraph_experiment:
      name: /Users/${workspace.current_user.userName}/${bundle.name}-${bundle.target}

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
            experiment_id: "${resources.experiments.agent_langgraph_experiment.id}"
            permission: 'CAN_MANAGE'

targets:
  dev:
    mode: development
"""

# A databricks.yml with experiment + database resource (like agent-langgraph-short-term-memory)
LAKEBASE_YML = """\
bundle:
  name: agent_langgraph_short_term_memory

resources:
  # MLflow experiment for agent tracing - automatically created by bundle
  experiments:
    agent_langgraph_short_term_memory_experiment:
      name: /Users/${workspace.current_user.userName}/${bundle.name}-${bundle.target}

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
          - name: LAKEBASE_INSTANCE_NAME
            value: "<your-lakebase-instance-name>"

      # Resources which this app has access to
      resources:
        - name: 'experiment'
          experiment:
            experiment_id: "${resources.experiments.agent_langgraph_short_term_memory_experiment.id}"
            permission: 'CAN_MANAGE'
        - name: 'database'
          database:
            instance_name: '<your-lakebase-instance-name>'
            database_name: 'databricks_postgres'
            permission: 'CAN_CONNECT_AND_CREATE'

targets:
  dev:
    mode: development
"""

# Double-quoted experiment name (like agent-langgraph-long-term-memory)
DOUBLE_QUOTED_YML = """\
bundle:
  name: agent_langgraph_long_term_memory

resources:
  # MLflow experiment for agent tracing - automatically created by bundle
  experiments:
    agent_langgraph_long_term_memory_experiment:
      name: /Users/${workspace.current_user.userName}/${bundle.name}-${bundle.target}

  apps:
    agent_langgraph_long_term_memory:
      name: "agent-langgraph-ltm"
      config:
        env:
          - name: MLFLOW_EXPERIMENT_ID
            value_from: "experiment"
          - name: LAKEBASE_INSTANCE_NAME
            value: "<your-lakebase-instance-name>"

      # Resources which this app has access to
      resources:
        - name: "experiment"
          experiment:
            experiment_id: "${resources.experiments.agent_langgraph_long_term_memory_experiment.id}"
            permission: "CAN_MANAGE"
        - name: "database"
          database:
            instance_name: "<your-lakebase-instance-name>"
            database_name: "databricks_postgres"
            permission: "CAN_CONNECT_AND_CREATE"

targets:
  dev:
    mode: development
"""


@pytest.fixture(autouse=True)
def _chdir(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)


class TestUpdateDatabricksYmlExperiment:
    def test_removes_experiment_resource_section(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(MINIMAL_YML)
        update_databricks_yml_experiment("12345")
        content = (tmp_path / "databricks.yml").read_text()
        assert "experiments:" not in content
        assert "agent_langgraph_experiment" not in content

    def test_removes_app_resource_entry(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(MINIMAL_YML)
        update_databricks_yml_experiment("12345")
        content = (tmp_path / "databricks.yml").read_text()
        assert "- name: 'experiment'" not in content
        assert "experiment_id:" not in content

    def test_replaces_value_from_with_value(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(MINIMAL_YML)
        update_databricks_yml_experiment("12345")
        content = (tmp_path / "databricks.yml").read_text()
        assert 'value: "12345"' in content
        assert "value_from" not in content

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

    def test_preserves_other_app_resources(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(LAKEBASE_YML)
        update_databricks_yml_experiment("12345")
        content = (tmp_path / "databricks.yml").read_text()
        assert "- name: 'database'" in content
        assert "instance_name:" in content
        assert "CAN_CONNECT_AND_CREATE" in content
        assert "- name: 'experiment'" not in content

    def test_handles_double_quoted_experiment_name(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(DOUBLE_QUOTED_YML)
        update_databricks_yml_experiment("99999")
        content = (tmp_path / "databricks.yml").read_text()
        assert '- name: "experiment"' not in content
        assert 'value: "99999"' in content
        assert '- name: "database"' in content


class TestUpdateDatabricksYmlLakebase:
    def test_replaces_placeholder_in_env_and_database(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(LAKEBASE_YML)
        update_databricks_yml_lakebase("my-instance")
        content = (tmp_path / "databricks.yml").read_text()
        assert "<your-lakebase-instance-name>" not in content
        assert "my-instance" in content
        # Both env var value and database instance_name should be replaced
        assert 'value: "my-instance"' in content
        assert "instance_name: 'my-instance'" in content

    def test_noop_without_placeholder(self, tmp_path):
        yml = MINIMAL_YML  # no lakebase placeholder
        (tmp_path / "databricks.yml").write_text(yml)
        update_databricks_yml_lakebase("my-instance")
        content = (tmp_path / "databricks.yml").read_text()
        assert content == yml

    def test_handles_missing_file(self, tmp_path):
        update_databricks_yml_lakebase("my-instance")
        assert not (tmp_path / "databricks.yml").exists()


class TestCombined:
    def test_both_functions_applied_in_sequence(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(LAKEBASE_YML)
        update_databricks_yml_experiment("54321")
        update_databricks_yml_lakebase("prod-db")
        content = (tmp_path / "databricks.yml").read_text()
        # Experiment changes
        assert "experiments:" not in content
        assert 'value: "54321"' in content
        assert "value_from" not in content
        # Lakebase changes
        assert "<your-lakebase-instance-name>" not in content
        assert "prod-db" in content

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
            assert "experiments:" not in content, f"{template_name}: experiments section not removed"
            assert "value_from" not in content, f"{template_name}: value_from not replaced"
            assert 'value: "99999"' in content, f"{template_name}: experiment ID not set"
            assert "- name: 'experiment'" not in content and '- name: "experiment"' not in content, (
                f"{template_name}: experiment app resource not removed"
            )

            # Lakebase replacement if applicable
            if "<your-lakebase-instance-name>" in yml_path.read_text():
                # Re-read after experiment update to also apply lakebase
                update_databricks_yml_lakebase("test-lb")
                content = (tdir / "databricks.yml").read_text()
                assert "<your-lakebase-instance-name>" not in content, (
                    f"{template_name}: lakebase placeholder not replaced"
                )
