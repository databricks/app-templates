# Tests for grant_lakebase_permissions.py
#
# Covers:
# 1. Data structures (MEMORY_TYPE_SCHEMAS, NEEDS_SEQUENCES, SHARED_SCHEMAS)
# 2. Argument parsing and validation (missing args, valid combos)
# 3. Correct LakebaseClient construction (provisioned vs autoscaling)
# 4. Per-memory-type grant calls (correct tables, schemas, sequences)
# 5. Idempotent role creation ("already exists" handling)

import sys
from unittest.mock import MagicMock, call, patch

import pytest

from grant_lakebase_permissions import (
    MEMORY_TYPE_SCHEMAS,
    NEEDS_SEQUENCES,
    SHARED_SCHEMAS,
    SHARED_SEQUENCE_SCHEMAS,
    main,
)


# ---------------------------------------------------------------------------
# Data structure tests
# ---------------------------------------------------------------------------
class TestDataStructures:
    def test_memory_type_schemas_has_all_types(self):
        assert set(MEMORY_TYPE_SCHEMAS.keys()) == {"langgraph", "openai"}

    def test_langgraph_tables(self):
        schemas = MEMORY_TYPE_SCHEMAS["langgraph"]
        public_tables = schemas["public"]
        assert "checkpoint_migrations" in public_tables
        assert "checkpoint_writes" in public_tables
        assert "checkpoints" in public_tables
        assert "checkpoint_blobs" in public_tables
        assert "store_migrations" in public_tables
        assert "store" in public_tables
        assert "store_vectors" in public_tables
        assert "vector_migrations" in public_tables
        agent_tables = schemas["agent_server"]
        assert "responses" in agent_tables
        assert "messages" in agent_tables

    def test_openai_tables(self):
        schemas = MEMORY_TYPE_SCHEMAS["openai"]
        public_tables = schemas["public"]
        assert "agent_sessions" in public_tables
        assert "agent_messages" in public_tables
        agent_tables = schemas["agent_server"]
        assert "responses" in agent_tables
        assert "messages" in agent_tables

    def test_needs_sequences(self):
        assert NEEDS_SEQUENCES == {
            "openai": ["public", "agent_server"],
            "langgraph": ["agent_server"],
        }

    def test_shared_schemas(self):
        assert "ai_chatbot" in SHARED_SCHEMAS
        assert "drizzle" in SHARED_SCHEMAS
        assert "Chat" in SHARED_SCHEMAS["ai_chatbot"]
        assert "__drizzle_migrations" in SHARED_SCHEMAS["drizzle"]

    def test_shared_sequence_schemas(self):
        assert "drizzle" in SHARED_SEQUENCE_SCHEMAS


# ---------------------------------------------------------------------------
# Argument parsing / validation tests
# ---------------------------------------------------------------------------
class TestArgumentParsing:
    def test_missing_sp_client_id_exits(self):
        with patch("sys.argv", ["grant_lakebase_permissions.py", "--memory-type", "langgraph", "--instance-name", "db"]):
            with pytest.raises(SystemExit) as exc_info:
                main()
            assert exc_info.value.code == 2  # argparse error

    def test_missing_memory_type_exits(self):
        with patch("sys.argv", ["grant_lakebase_permissions.py", "sp-123", "--instance-name", "db"]):
            with pytest.raises(SystemExit) as exc_info:
                main()
            assert exc_info.value.code == 2

    def test_invalid_memory_type_exits(self):
        with patch("sys.argv", ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "invalid-type", "--instance-name", "db"]):
            with pytest.raises(SystemExit) as exc_info:
                main()
            assert exc_info.value.code == 2

    def test_no_connection_info_exits(self, monkeypatch):
        monkeypatch.delenv("LAKEBASE_INSTANCE_NAME", raising=False)
        monkeypatch.delenv("LAKEBASE_AUTOSCALING_PROJECT", raising=False)
        monkeypatch.delenv("LAKEBASE_AUTOSCALING_BRANCH", raising=False)
        with patch("sys.argv", ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "langgraph"]):
            with pytest.raises(SystemExit) as exc_info:
                main()
            assert exc_info.value.code == 1

    def test_partial_autoscaling_exits(self, monkeypatch):
        monkeypatch.delenv("LAKEBASE_INSTANCE_NAME", raising=False)
        monkeypatch.delenv("LAKEBASE_AUTOSCALING_PROJECT", raising=False)
        monkeypatch.delenv("LAKEBASE_AUTOSCALING_BRANCH", raising=False)
        with patch("sys.argv", ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "langgraph", "--project", "my-proj"]):
            with pytest.raises(SystemExit) as exc_info:
                main()
            assert exc_info.value.code == 1


# ---------------------------------------------------------------------------
# Helper to build a mock LakebaseClient and run main()
# ---------------------------------------------------------------------------
def _run_main(argv, monkeypatch):
    monkeypatch.delenv("LAKEBASE_INSTANCE_NAME", raising=False)
    monkeypatch.delenv("LAKEBASE_AUTOSCALING_PROJECT", raising=False)
    monkeypatch.delenv("LAKEBASE_AUTOSCALING_BRANCH", raising=False)

    mock_client = MagicMock()
    mock_client.__enter__ = MagicMock(return_value=mock_client)
    mock_client.__exit__ = MagicMock(return_value=False)
    mock_module = MagicMock()
    mock_module.LakebaseClient.return_value = mock_client
    mock_module.SchemaPrivilege.USAGE = "USAGE"
    mock_module.SchemaPrivilege.CREATE = "CREATE"
    mock_module.TablePrivilege.SELECT = "SELECT"
    mock_module.TablePrivilege.INSERT = "INSERT"
    mock_module.TablePrivilege.UPDATE = "UPDATE"
    mock_module.TablePrivilege.DELETE = "DELETE"
    mock_module.SequencePrivilege.USAGE = "SEQ_USAGE"
    mock_module.SequencePrivilege.SELECT = "SEQ_SELECT"
    mock_module.SequencePrivilege.UPDATE = "SEQ_UPDATE"

    with patch("sys.argv", argv), patch.dict("sys.modules", {"databricks_ai_bridge.lakebase": mock_module}):
        main()

    return mock_client, mock_module


# ---------------------------------------------------------------------------
# LakebaseClient construction tests
# ---------------------------------------------------------------------------
class TestLakebaseClientConstruction:
    def test_provisioned_client(self, monkeypatch):
        mock_client, mock_module = _run_main(
            ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "langgraph", "--instance-name", "my-db"],
            monkeypatch,
        )
        mock_module.LakebaseClient.assert_called_once_with(
            instance_name="my-db", project=None, branch=None
        )

    def test_autoscaling_client(self, monkeypatch):
        mock_client, mock_module = _run_main(
            ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "langgraph", "--project", "proj-1", "--branch", "production"],
            monkeypatch,
        )
        mock_module.LakebaseClient.assert_called_once_with(
            instance_name=None, project="proj-1", branch="production"
        )


# ---------------------------------------------------------------------------
# Grant call tests per memory type
# ---------------------------------------------------------------------------
class TestGrantCalls:
    def _get_granted_tables(self, mock_client):
        tables = []
        for c in mock_client.grant_table.call_args_list:
            tables.extend(c.kwargs.get("tables", c[1].get("tables", [])) if c.kwargs else c[1].get("tables", []))
        return tables

    def _get_granted_schemas(self, mock_client):
        schemas = []
        for c in mock_client.grant_schema.call_args_list:
            schemas.extend(c.kwargs.get("schemas", c[1].get("schemas", [])) if c.kwargs else c[1].get("schemas", []))
        return schemas

    def test_langgraph_grants(self, monkeypatch):
        mock_client, _ = _run_main(
            ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "langgraph", "--instance-name", "db"],
            monkeypatch,
        )
        tables = self._get_granted_tables(mock_client)
        # Short-term (checkpoint) tables
        assert "public.checkpoint_migrations" in tables
        assert "public.checkpoints" in tables
        assert "public.checkpoint_writes" in tables
        assert "public.checkpoint_blobs" in tables
        # Long-term (store) tables
        assert "public.store_migrations" in tables
        assert "public.store" in tables
        assert "public.store_vectors" in tables
        assert "public.vector_migrations" in tables
        # Agent server tables
        assert "agent_server.responses" in tables
        assert "agent_server.messages" in tables
        # Should NOT have openai tables
        assert "public.agent_sessions" not in tables
        # Shared schema tables
        assert "ai_chatbot.Chat" in tables
        assert "drizzle.__drizzle_migrations" in tables
        # Sequence grants: drizzle (shared) + agent_server (per-type)
        assert mock_client.grant_all_sequences_in_schema.call_count == 2
        seq_schemas = [c.kwargs["schemas"][0] for c in mock_client.grant_all_sequences_in_schema.call_args_list]
        assert "drizzle" in seq_schemas
        assert "agent_server" in seq_schemas

    def test_openai_grants(self, monkeypatch):
        mock_client, _ = _run_main(
            ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "openai", "--instance-name", "db"],
            monkeypatch,
        )
        tables = self._get_granted_tables(mock_client)
        # OpenAI session tables
        assert "public.agent_sessions" in tables
        assert "public.agent_messages" in tables
        # Agent server tables
        assert "agent_server.responses" in tables
        assert "agent_server.messages" in tables
        # Should NOT have langgraph tables
        assert "public.checkpoints" not in tables
        assert "public.store" not in tables
        # Shared schema tables
        assert "ai_chatbot.Chat" in tables
        # Sequence grants: drizzle (shared) + public + agent_server (per-type)
        assert mock_client.grant_all_sequences_in_schema.call_count == 3
        seq_schemas = [c.kwargs["schemas"][0] for c in mock_client.grant_all_sequences_in_schema.call_args_list]
        assert "drizzle" in seq_schemas
        assert "public" in seq_schemas
        assert "agent_server" in seq_schemas

    def test_schemas_granted_for_all_types(self, monkeypatch):
        for memory_type in MEMORY_TYPE_SCHEMAS:
            mock_client, _ = _run_main(
                ["grant_lakebase_permissions.py", "sp-123", "--memory-type", memory_type, "--instance-name", "db"],
                monkeypatch,
            )
            schemas = self._get_granted_schemas(mock_client)
            assert "ai_chatbot" in schemas, f"{memory_type}: missing ai_chatbot schema"
            assert "drizzle" in schemas, f"{memory_type}: missing drizzle schema"
            for schema in MEMORY_TYPE_SCHEMAS[memory_type]:
                assert schema in schemas, f"{memory_type}: missing {schema} schema"

    def test_role_created_with_sp_id(self, monkeypatch):
        mock_client, _ = _run_main(
            ["grant_lakebase_permissions.py", "sp-abc-123", "--memory-type", "langgraph", "--instance-name", "db"],
            monkeypatch,
        )
        mock_client.create_role.assert_called_once_with("sp-abc-123", "SERVICE_PRINCIPAL")

    def test_grantee_is_sp_id(self, monkeypatch):
        mock_client, _ = _run_main(
            ["grant_lakebase_permissions.py", "sp-xyz", "--memory-type", "langgraph", "--instance-name", "db"],
            monkeypatch,
        )
        for c in mock_client.grant_schema.call_args_list:
            assert c.kwargs["grantee"] == "sp-xyz"
        for c in mock_client.grant_table.call_args_list:
            assert c.kwargs["grantee"] == "sp-xyz"

    def test_table_privileges(self, monkeypatch):
        mock_client, _ = _run_main(
            ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "langgraph", "--instance-name", "db"],
            monkeypatch,
        )
        for c in mock_client.grant_table.call_args_list:
            privs = c.kwargs["privileges"]
            assert "SELECT" in privs
            assert "INSERT" in privs
            assert "UPDATE" in privs
            assert "DELETE" in privs

    def test_schema_privileges(self, monkeypatch):
        mock_client, _ = _run_main(
            ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "langgraph", "--instance-name", "db"],
            monkeypatch,
        )
        for c in mock_client.grant_schema.call_args_list:
            privs = c.kwargs["privileges"]
            assert "USAGE" in privs
            assert "CREATE" in privs


# ---------------------------------------------------------------------------
# Error handling tests
# ---------------------------------------------------------------------------
class TestErrorHandling:
    def test_role_already_exists_continues(self, monkeypatch):
        mock_client, mock_module = _run_main(
            ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "langgraph", "--instance-name", "db"],
            monkeypatch,
        )
        assert mock_client.grant_schema.called

        mock_module.LakebaseClient.return_value.create_role.side_effect = Exception("Role already exists")
        mock_client2, _ = _run_main(
            ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "langgraph", "--instance-name", "db"],
            monkeypatch,
        )
        assert mock_client2.grant_schema.called

    def test_role_creation_other_error_raises(self, monkeypatch):
        monkeypatch.delenv("LAKEBASE_INSTANCE_NAME", raising=False)
        monkeypatch.delenv("LAKEBASE_AUTOSCALING_PROJECT", raising=False)
        monkeypatch.delenv("LAKEBASE_AUTOSCALING_BRANCH", raising=False)

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.create_role.side_effect = Exception("Connection refused")
        mock_module = MagicMock()
        mock_module.LakebaseClient.return_value = mock_client

        with patch("sys.argv", ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "langgraph", "--instance-name", "db"]):
            with patch.dict("sys.modules", {"databricks_ai_bridge.lakebase": mock_module}):
                with pytest.raises(Exception, match="Connection refused"):
                    main()

    def test_grant_failures_do_not_abort(self, monkeypatch):
        monkeypatch.delenv("LAKEBASE_INSTANCE_NAME", raising=False)
        monkeypatch.delenv("LAKEBASE_AUTOSCALING_PROJECT", raising=False)
        monkeypatch.delenv("LAKEBASE_AUTOSCALING_BRANCH", raising=False)

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.grant_schema.side_effect = Exception("schema not found")
        mock_client.grant_table.side_effect = Exception("table not found")
        mock_module = MagicMock()
        mock_module.LakebaseClient.return_value = mock_client

        with patch("sys.argv", ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "langgraph", "--instance-name", "db"]):
            with patch.dict("sys.modules", {"databricks_ai_bridge.lakebase": mock_module}):
                main()

        # langgraph has: public, agent_server, ai_chatbot, drizzle = 4 schemas
        assert mock_client.grant_schema.call_count == 4
        assert mock_client.grant_table.call_count == 4
