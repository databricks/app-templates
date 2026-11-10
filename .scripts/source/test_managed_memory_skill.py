import ast
import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from databricks.sdk.errors import (
    BadRequest,
    DataLoss,
    DatabricksError,
    PermissionDenied,
    TemporarilyUnavailable,
)


REPO_ROOT = Path(__file__).resolve().parents[2]
SKILL_PATHS = [
    REPO_ROOT / ".claude/skills/managed-memory/SKILL.md",
    REPO_ROOT / "agent-langgraph-advanced/.claude/skills/managed-memory/SKILL.md",
    REPO_ROOT / "agent-langgraph/.claude/skills/managed-memory/SKILL.md",
    REPO_ROOT / "agent-openai-advanced/.claude/skills/managed-memory/SKILL.md",
    REPO_ROOT / "agent-openai-agents-sdk-multiagent/.claude/skills/managed-memory/SKILL.md",
    REPO_ROOT / "agent-openai-agents-sdk/.claude/skills/managed-memory/SKILL.md",
]


def _skill_text() -> str:
    return SKILL_PATHS[0].read_text()


def _python_blocks() -> list[str]:
    return re.findall(r"```python\n(.*?)\n```", _skill_text(), re.DOTALL)


def _shared_core_namespace() -> dict:
    source = next(block for block in _python_blocks() if "def _search(" in block)
    source = source.replace(
        "from mlflow.genai.agent_server import get_request_headers\n", ""
    ).replace("from agent_server.utils import get_user_workspace_client\n", "")
    namespace = {
        "get_request_headers": lambda: {},
        "get_user_workspace_client": lambda: None,
    }
    exec(compile(source, "managed-memory-shared-core", "exec"), namespace)
    return namespace


class FakeApiClient:
    def __init__(self, result=None, error: Exception | None = None):
        self.result = result
        self.error = error
        self.calls = []

    def do(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        if self.error:
            raise self.error
        return self.result


def _install_api(namespace: dict, *, result=None, error=None) -> FakeApiClient:
    api_client = FakeApiClient(result=result, error=error)
    namespace["_ws"] = lambda: SimpleNamespace(api_client=api_client)
    namespace["_entries"] = lambda suffix="": f"/entries{suffix}"
    return api_client


def test_all_six_skill_copies_are_identical():
    contents = [path.read_bytes() for path in SKILL_PATHS]
    assert len(contents) == 6
    assert len(set(contents)) == 1


def test_markdown_python_snippets_parse_and_fences_balance():
    text = _skill_text()
    assert text.count("```") % 2 == 0
    blocks = _python_blocks()
    assert blocks
    for block in blocks:
        ast.parse(block)


def test_model_prompt_keeps_query_details_in_the_tool_description():
    text = _skill_text()
    prompt = re.search(
        r'MEMORY_INSTRUCTIONS = """(.*?)"""', text, re.DOTALL
    ).group(1)
    assert "Do not search merely because" not in prompt
    assert "For each search, use one concise" not in prompt
    assert "raise top_k or fall back" not in prompt
    assert "don't raise top_k merely to enumerate" in prompt
    assert "use list_memories and summarize from descriptions" in prompt
    assert "retry the same search once" in text
    assert "favourite pet user favourite pet" not in text
    assert "List EVERY saved memory" not in text


def test_search_validates_blank_query_and_invalid_top_k_without_api_call():
    namespace = _shared_core_namespace()
    assert namespace["_search"]("scope", "   ") == (
        "Search query must be a non-empty description of the information needed."
    )
    assert namespace["_search"]("scope", "project", "many") == (
        "top_k must be an integer from 1 to 50."
    )


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (TemporarilyUnavailable("temporary"), "Retry the search once"),
        (DataLoss("corrupt", error_code="DATA_LOSS"), "non-retryable data loss"),
        (PermissionDenied("denied"), "Do not call more memory tools"),
        (
            BadRequest("blank", error_code="INVALID_PARAMETER_VALUE"),
            "Correct the query or top_k and retry once",
        ),
        (
            BadRequest("bad shape", error_code="UNKNOWN_BAD_REQUEST"),
            "Do not retry unless the message identifies a fix",
        ),
        (DatabricksError("unknown"), "Could not search memories: unknown"),
    ],
)
def test_search_routes_sdk_errors(error, expected):
    namespace = _shared_core_namespace()
    _install_api(namespace, error=error)
    assert expected in namespace["_search"]("scope", "project priorities")


def test_search_clamps_top_k_and_tolerates_missing_score_or_entry():
    namespace = _shared_core_namespace()
    api_client = _install_api(
        namespace,
        result={"results": [{"memory_entry": None, "score": None}]},
    )
    output = namespace["_search"]("scope", "project priorities", 500)
    assert "score unavailable" in output
    assert api_client.calls[0][2]["body"] == {
        "query": "project priorities",
        "top_k": 50,
    }


def test_list_uses_real_pagination_parameters_and_returns_next_token():
    namespace = _shared_core_namespace()
    api_client = _install_api(
        namespace,
        result={
            "entries": [
                {
                    "path": "/memories/projects/search.md",
                    "description": "Search project",
                    "has_contents": True,
                }
            ],
            "next_page_token": "a+b=",
        },
    )
    output = namespace["_list"]("scope")
    assert output.startswith("first 1 memories:")
    assert "page_token='a+b='" in output
    assert api_client.calls[0][2]["query"] == {
        "scope": "scope",
        "page_size": 200,
    }

    api_client = _install_api(namespace, result={"entries": []})
    assert namespace["_list"]("scope", "a+b=") == "No more memories."
    assert api_client.calls[0][2]["query"] == {
        "scope": "scope",
        "page_size": 200,
        "page_token": "a+b=",
    }


def test_openai_search_tool_schema_keeps_top_k_optional():
    source = next(
        block
        for block in _python_blocks()
        if "from agents import RunContextWrapper, function_tool" in block
    )
    namespace = {
        "_search": lambda *args, **kwargs: "",
        "_save": lambda *args, **kwargs: "",
        "_get": lambda *args, **kwargs: "",
        "_list": lambda *args, **kwargs: "",
        "_update": lambda *args, **kwargs: "",
        "_delete": lambda *args, **kwargs: "",
    }
    exec(compile(source, "managed-memory-openai-wrappers", "exec"), namespace)
    schema = namespace["search_memory"].params_json_schema
    assert schema["required"] == ["query"]
    assert schema["properties"]["top_k"]["default"] == 10
