# Quickstart script functionality:
# 1. Checks prerequisites (uv, node, npm, databricks CLI) and validates Node.js version
# 2. Creates .env from .env.example (or from scratch)
# 3. Sets up Databricks authentication (validates/creates profile)
# 4. Gets Databricks username via current-user API
# 5. Creates MLflow experiment via `databricks experiments create-experiment`
# 6. Updates .env with: DATABRICKS_CONFIG_PROFILE, MLFLOW_TRACKING_URI, MLFLOW_EXPERIMENT_ID
# 7. Updates databricks.yml: sets experiment_id in app resource
# 8. (If lakebase needed) Sets up Lakebase (provisioned or autoscaling), updates .env

import os
from pathlib import Path

import pytest

from quickstart import update_databricks_yml_experiment

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

# A databricks.yml with autoscaling lakebase resources (like agent-langgraph-short-term-memory)
LAKEBASE_AUTOSCALING_YML = """\
bundle:
  name: agent_langgraph_short_term_memory

resources:
  postgres_projects:
    lakebase_project:
      project_id: '<your-project-id>'
      display_name: 'Short-Term Memory Database'
      pg_version: 17

  postgres_branches:
    lakebase_branch:
      parent: ${resources.postgres_projects.lakebase_project.id}
      branch_id: '<your-branch-id>'
      is_protected: false
      no_expiry: true

  postgres_endpoints:
    lakebase_endpoint:
      parent: ${resources.postgres_branches.lakebase_branch.id}
      endpoint_id: primary
      endpoint_type: ENDPOINT_TYPE_READ_WRITE
      autoscaling_limit_min_cu: 0.5
      autoscaling_limit_max_cu: 4

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
          # Use for provisioned lakebase resource
          # - name: LAKEBASE_INSTANCE_NAME
          #   value: "<your-lakebase-instance-name>"

      # Resources which this app has access to
      resources:
        - name: 'experiment'
          experiment:
            experiment_id: ""
            permission: 'CAN_MANAGE'
        # Use for autoscaling lakebase resource (recommended)
        - name: 'postgres'
          postgres:
            branch: ${resources.postgres_branches.lakebase_branch.id}
            database: ${resources.postgres_branches.lakebase_branch.id}/databases/postgres
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

# Double-quoted variant (like agent-langgraph-long-term-memory)
LAKEBASE_AUTOSCALING_DOUBLE_QUOTED_YML = """\
bundle:
  name: agent_langgraph_long_term_memory

resources:
  postgres_projects:
    lakebase_project:
      project_id: '<your-project-id>'
      display_name: 'Long-Term Memory Database'
      pg_version: 17

  postgres_branches:
    lakebase_branch:
      parent: ${resources.postgres_projects.lakebase_project.id}
      branch_id: '<your-branch-id>'
      is_protected: false
      no_expiry: true

  postgres_endpoints:
    lakebase_endpoint:
      parent: ${resources.postgres_branches.lakebase_branch.id}
      endpoint_id: primary
      endpoint_type: ENDPOINT_TYPE_READ_WRITE
      autoscaling_limit_min_cu: 0.5
      autoscaling_limit_max_cu: 4

  apps:
    agent_langgraph_long_term_memory:
      name: "agent-langgraph-ltm"
      config:
        env:
          - name: MLFLOW_EXPERIMENT_ID
            value_from: "experiment"
          # Use for provisioned lakebase resource
          # - name: LAKEBASE_INSTANCE_NAME
          #   value: "<your-lakebase-instance-name>"

      # Resources which this app has access to
      resources:
        - name: "experiment"
          experiment:
            experiment_id: ""
            permission: "CAN_MANAGE"
        # Use for autoscaling lakebase resource (recommended)
        - name: "postgres"
          postgres:
            branch: ${resources.postgres_branches.lakebase_branch.id}
            database: ${resources.postgres_branches.lakebase_branch.id}/databases/postgres
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

    def test_preserves_other_app_resources(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(LAKEBASE_AUTOSCALING_YML)
        update_databricks_yml_experiment("12345")
        content = (tmp_path / "databricks.yml").read_text()
        assert "postgres:" in content
        assert "CAN_CONNECT_AND_CREATE" in content

    def test_handles_double_quoted_experiment_name(self, tmp_path):
        (tmp_path / "databricks.yml").write_text(LAKEBASE_AUTOSCALING_DOUBLE_QUOTED_YML)
        update_databricks_yml_experiment("99999")
        content = (tmp_path / "databricks.yml").read_text()
        assert 'experiment_id: "99999"' in content
        assert '"postgres"' in content

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
