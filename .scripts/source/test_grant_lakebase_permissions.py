# Tests for grant_lakebase_permissions.py
#
# Covers:
# 1. Data structures (MEMORY_TYPE_TABLES, NEEDS_SEQUENCES, SHARED_SCHEMAS)
# 2. Argument parsing and validation (missing args, valid combos)
# 3. Correct LakebaseClient construction (provisioned vs autoscaling)
# 4. Per-memory-type grant calls (correct tables, schemas, sequences)
# 5. Idempotent role creation ("already exists" handling)

import sys
from unittest.mock import MagicMock, call, patch

import pytest

from grant_lakebase_permissions import (
    MEMORY_TYPE_TABLES,
    NEEDS_SEQUENCES,
    SHARED_SCHEMAS,
    main,
)


# ---------------------------------------------------------------------------
# Data structure tests
# ---------------------------------------------------------------------------
class TestDataStructures:
    def test_memory_type_tables_has_all_types(self):
        assert set(MEMORY_TYPE_TABLES.keys()) == {
            "langgraph-short-term",
            "langgraph-long-term",
            "openai-short-term",
        }

    def test_langgraph_short_term_tables(self):
        tables = MEMORY_TYPE_TABLES["langgraph-short-term"]
        assert "checkpoint_migrations" in tables
        assert "checkpoint_writes" in tables
        assert "checkpoints" in tables
        assert "checkpoint_blobs" in tables

    def test_langgraph_long_term_tables(self):
        tables = MEMORY_TYPE_TABLES["langgraph-long-term"]
        assert "store_migrations" in tables
        assert "store" in tables
        assert "store_vectors" in tables
        assert "vector_migrations" in tables

    def test_openai_short_term_tables(self):
        tables = MEMORY_TYPE_TABLES["openai-short-term"]
        assert "agent_sessions" in tables
        assert "agent_messages" in tables

    def test_only_openai_needs_sequences(self):
        assert NEEDS_SEQUENCES == {"openai-short-term"}

    def test_shared_schemas(self):
        assert "ai_chatbot" in SHARED_SCHEMAS
        assert "drizzle" in SHARED_SCHEMAS
        assert "Chat" in SHARED_SCHEMAS["ai_chatbot"]
        assert "__drizzle_migrations" in SHARED_SCHEMAS["drizzle"]

    def test_no_table_overlap_between_memory_types(self):
        all_tables = []
        for tables in MEMORY_TYPE_TABLES.values():
            all_tables.extend(tables)
        assert len(all_tables) == len(set(all_tables)), "Tables should not overlap between memory types"


# ---------------------------------------------------------------------------
# Argument parsing / validation tests
# ---------------------------------------------------------------------------
class TestArgumentParsing:
    def test_missing_sp_client_id_exits(self):
        with patch("sys.argv", ["grant_lakebase_permissions.py", "--memory-type", "langgraph-short-term", "--instance-name", "db"]):
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
        """Neither --instance-name nor --project/--branch provided."""
        monkeypatch.delenv("LAKEBASE_INSTANCE_NAME", raising=False)
        monkeypatch.delenv("LAKEBASE_AUTOSCALING_PROJECT", raising=False)
        monkeypatch.delenv("LAKEBASE_AUTOSCALING_BRANCH", raising=False)
        with patch("sys.argv", ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "langgraph-short-term"]):
            with pytest.raises(SystemExit) as exc_info:
                main()
            assert exc_info.value.code == 1

    def test_partial_autoscaling_exits(self, monkeypatch):
        """Only --project without --branch should fail."""
        monkeypatch.delenv("LAKEBASE_INSTANCE_NAME", raising=False)
        monkeypatch.delenv("LAKEBASE_AUTOSCALING_PROJECT", raising=False)
        monkeypatch.delenv("LAKEBASE_AUTOSCALING_BRANCH", raising=False)
        with patch("sys.argv", ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "langgraph-short-term", "--project", "my-proj"]):
            with pytest.raises(SystemExit) as exc_info:
                main()
            assert exc_info.value.code == 1


# ---------------------------------------------------------------------------
# Helper to build a mock LakebaseClient and run main()
# ---------------------------------------------------------------------------
def _run_main(argv, monkeypatch):
    """Run main() with mocked LakebaseClient, return (mock_client, mock_module)."""
    monkeypatch.delenv("LAKEBASE_INSTANCE_NAME", raising=False)
    monkeypatch.delenv("LAKEBASE_AUTOSCALING_PROJECT", raising=False)
    monkeypatch.delenv("LAKEBASE_AUTOSCALING_BRANCH", raising=False)

    mock_client = MagicMock()
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
    mock_module.SequencePrivilege.DELETE = "SEQ_DELETE"

    with patch("sys.argv", argv), patch.dict("sys.modules", {"databricks_ai_bridge.lakebase": mock_module}):
        main()

    return mock_client, mock_module


# ---------------------------------------------------------------------------
# LakebaseClient construction tests
# ---------------------------------------------------------------------------
class TestLakebaseClientConstruction:
    def test_provisioned_client(self, monkeypatch):
        mock_client, mock_module = _run_main(
            ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "langgraph-short-term", "--instance-name", "my-db"],
            monkeypatch,
        )
        mock_module.LakebaseClient.assert_called_once_with(
            instance_name="my-db", project=None, branch=None
        )

    def test_autoscaling_client(self, monkeypatch):
        mock_client, mock_module = _run_main(
            ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "langgraph-short-term", "--project", "proj-1", "--branch", "production"],
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
        """Extract all tables from grant_table calls."""
        tables = []
        for c in mock_client.grant_table.call_args_list:
            tables.extend(c.kwargs.get("tables", c[1].get("tables", [])) if c.kwargs else c[1].get("tables", []))
        return tables

    def _get_granted_schemas(self, mock_client):
        """Extract all schemas from grant_schema calls."""
        schemas = []
        for c in mock_client.grant_schema.call_args_list:
            schemas.extend(c.kwargs.get("schemas", c[1].get("schemas", [])) if c.kwargs else c[1].get("schemas", []))
        return schemas

    def test_langgraph_short_term_grants(self, monkeypatch):
        mock_client, _ = _run_main(
            ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "langgraph-short-term", "--instance-name", "db"],
            monkeypatch,
        )
        tables = self._get_granted_tables(mock_client)
        # Should have public schema tables
        assert "public.checkpoint_migrations" in tables
        assert "public.checkpoints" in tables
        assert "public.checkpoint_writes" in tables
        assert "public.checkpoint_blobs" in tables
        # Should NOT have long-term or openai tables
        assert not any("store" in t for t in tables if "drizzle" not in t)
        assert "public.agent_sessions" not in tables
        # Should have shared schema tables
        assert "ai_chatbot.Chat" in tables
        assert "drizzle.__drizzle_migrations" in tables
        # No sequence grants
        mock_client.grant_all_sequences_in_schema.assert_not_called()

    def test_langgraph_long_term_grants(self, monkeypatch):
        mock_client, _ = _run_main(
            ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "langgraph-long-term", "--instance-name", "db"],
            monkeypatch,
        )
        tables = self._get_granted_tables(mock_client)
        assert "public.store_migrations" in tables
        assert "public.store" in tables
        assert "public.store_vectors" in tables
        assert "public.vector_migrations" in tables
        # Should NOT have short-term tables
        assert "public.checkpoints" not in tables
        assert "public.agent_sessions" not in tables
        # Should have shared schemas
        assert "ai_chatbot.Chat" in tables
        # No sequence grants
        mock_client.grant_all_sequences_in_schema.assert_not_called()

    def test_openai_short_term_grants(self, monkeypatch):
        mock_client, _ = _run_main(
            ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "openai-short-term", "--instance-name", "db"],
            monkeypatch,
        )
        tables = self._get_granted_tables(mock_client)
        assert "public.agent_sessions" in tables
        assert "public.agent_messages" in tables
        # Should NOT have langgraph tables
        assert "public.checkpoints" not in tables
        assert "public.store" not in tables
        # Should have shared schemas
        assert "ai_chatbot.Chat" in tables
        # SHOULD have sequence grants (openai-short-term needs them)
        mock_client.grant_all_sequences_in_schema.assert_called_once()

    def test_schemas_granted_for_all_types(self, monkeypatch):
        """All memory types should grant public + ai_chatbot + drizzle schemas."""
        for memory_type in MEMORY_TYPE_TABLES:
            mock_client, _ = _run_main(
                ["grant_lakebase_permissions.py", "sp-123", "--memory-type", memory_type, "--instance-name", "db"],
                monkeypatch,
            )
            schemas = self._get_granted_schemas(mock_client)
            assert "public" in schemas, f"{memory_type}: missing public schema"
            assert "ai_chatbot" in schemas, f"{memory_type}: missing ai_chatbot schema"
            assert "drizzle" in schemas, f"{memory_type}: missing drizzle schema"

    def test_role_created_with_sp_id(self, monkeypatch):
        mock_client, _ = _run_main(
            ["grant_lakebase_permissions.py", "sp-abc-123", "--memory-type", "langgraph-short-term", "--instance-name", "db"],
            monkeypatch,
        )
        mock_client.create_role.assert_called_once_with("sp-abc-123", "SERVICE_PRINCIPAL")

    def test_grantee_is_sp_id(self, monkeypatch):
        """All grant calls should use the SP client ID as grantee."""
        mock_client, _ = _run_main(
            ["grant_lakebase_permissions.py", "sp-xyz", "--memory-type", "langgraph-short-term", "--instance-name", "db"],
            monkeypatch,
        )
        for c in mock_client.grant_schema.call_args_list:
            assert c.kwargs["grantee"] == "sp-xyz"
        for c in mock_client.grant_table.call_args_list:
            assert c.kwargs["grantee"] == "sp-xyz"

    def test_table_privileges(self, monkeypatch):
        """All grant_table calls should request SELECT, INSERT, UPDATE, DELETE."""
        mock_client, _ = _run_main(
            ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "langgraph-short-term", "--instance-name", "db"],
            monkeypatch,
        )
        for c in mock_client.grant_table.call_args_list:
            privs = c.kwargs["privileges"]
            assert "SELECT" in privs
            assert "INSERT" in privs
            assert "UPDATE" in privs
            assert "DELETE" in privs

    def test_schema_privileges(self, monkeypatch):
        """All grant_schema calls should request USAGE, CREATE."""
        mock_client, _ = _run_main(
            ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "langgraph-short-term", "--instance-name", "db"],
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
        """'already exists' error on create_role should be ignored."""
        mock_client, mock_module = _run_main(
            ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "langgraph-short-term", "--instance-name", "db"],
            monkeypatch,
        )
        # Verify it ran to completion (grant_schema was called)
        assert mock_client.grant_schema.called

        # Now test with "already exists" exception
        mock_module.LakebaseClient.return_value.create_role.side_effect = Exception("Role already exists")
        mock_client2, _ = _run_main(
            ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "langgraph-short-term", "--instance-name", "db"],
            monkeypatch,
        )
        # Should still proceed to grants
        assert mock_client2.grant_schema.called

    def test_role_creation_other_error_raises(self, monkeypatch):
        """Non-'already exists' errors on create_role should propagate."""
        monkeypatch.delenv("LAKEBASE_INSTANCE_NAME", raising=False)
        monkeypatch.delenv("LAKEBASE_AUTOSCALING_PROJECT", raising=False)
        monkeypatch.delenv("LAKEBASE_AUTOSCALING_BRANCH", raising=False)

        mock_client = MagicMock()
        mock_client.create_role.side_effect = Exception("Connection refused")
        mock_module = MagicMock()
        mock_module.LakebaseClient.return_value = mock_client

        with patch("sys.argv", ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "langgraph-short-term", "--instance-name", "db"]):
            with patch.dict("sys.modules", {"databricks_ai_bridge.lakebase": mock_module}):
                with pytest.raises(Exception, match="Connection refused"):
                    main()

    def test_grant_failures_do_not_abort(self, monkeypatch):
        """Warnings on grant_schema/grant_table should not stop execution."""
        monkeypatch.delenv("LAKEBASE_INSTANCE_NAME", raising=False)
        monkeypatch.delenv("LAKEBASE_AUTOSCALING_PROJECT", raising=False)
        monkeypatch.delenv("LAKEBASE_AUTOSCALING_BRANCH", raising=False)

        mock_client = MagicMock()
        mock_client.grant_schema.side_effect = Exception("schema not found")
        mock_client.grant_table.side_effect = Exception("table not found")
        mock_module = MagicMock()
        mock_module.LakebaseClient.return_value = mock_client

        with patch("sys.argv", ["grant_lakebase_permissions.py", "sp-123", "--memory-type", "langgraph-short-term", "--instance-name", "db"]):
            with patch.dict("sys.modules", {"databricks_ai_bridge.lakebase": mock_module}):
                # Should NOT raise - grant failures are warnings
                main()

        # All schemas should have been attempted
        assert mock_client.grant_schema.call_count == 3  # public, ai_chatbot, drizzle
        assert mock_client.grant_table.call_count == 3
