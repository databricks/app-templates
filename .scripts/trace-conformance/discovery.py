import re
import os
from dataclasses import dataclass
from pathlib import Path


_SOURCE_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".jsx"}
_CONFIG_SUFFIXES = {".json", ".yaml", ".yml", ".tmpl", ".toml"}
_EXCLUDED_PARTS = {
    ".git",
    ".pytest_cache",
    ".venv",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "test",
    "tests",
}
_UC_ENV = {
    "MLFLOW_EXPERIMENT_ID",
    "MLFLOW_TRACING_SQL_WAREHOUSE_ID",
    "MLFLOW_UC_CATALOG",
    "MLFLOW_UC_SCHEMA",
    "MLFLOW_UC_TABLE_PREFIX",
    "MLFLOW_OTEL_SPANS_TABLE",
}


@dataclass(frozen=True)
class AgentTemplate:
    name: str
    path: Path
    signals: tuple[str, ...]
    has_uc_resources: bool
    has_local_conformance: bool
    has_deployed_verification: bool
    local_test_command: tuple[str, ...] | None = None


def _read(path: Path) -> str:
    try:
        if path.stat().st_size > 1_000_000:
            return ""
        return path.read_text(errors="ignore")
    except (OSError, UnicodeError):
        return ""


def _production_source(template: Path) -> str:
    chunks = []
    for path in _iter_files(template, _SOURCE_SUFFIXES, exclude_tests=True):
        chunks.append(_read(path))
    return "\n".join(chunks)


def _signals(source: str) -> tuple[str, ...]:
    signals = []
    if re.search(r"\bAgentServer\b", source):
        signals.append("agent-server")
    if re.search(
        r"\b(?:Agent|ResponsesAgent|ChatAgent|createAgent|createReactAgent|create_react_agent)\s*\(",
        source,
    ):
        signals.append("agent-constructor")
    if re.search(
        r"(?:\.responses\.create\s*\(|/agent/v\d+/|/invocations\b|agents/[\w./-]+)",
        source,
    ):
        signals.append("agent-endpoint")
    if (
        re.search(r"\bwhile\b", source)
        and re.search(r"\b(?:model|llm)\b", source, re.IGNORECASE)
        and re.search(r"\btool(?:_calls?)?\b|\.execute\s*\(", source, re.IGNORECASE)
    ):
        signals.append("model-tool-loop")
    if re.search(
        r"\b(?:retriev\w*|vector[_ ]?search|similaritySearch)\b", source, re.IGNORECASE
    ) and re.search(r"\b(?:generate|model|llm|chat)\b", source, re.IGNORECASE):
        signals.append("retrieval-generation")
    return tuple(signals)


def _all_text(template: Path, *, suffixes: set[str]) -> str:
    return "\n".join(_read(path) for path in _iter_files(template, suffixes))


def _iter_files(root: Path, suffixes: set[str], *, exclude_tests: bool = False):
    for directory, names, files in os.walk(root):
        names[:] = [
            name
            for name in names
            if (
                name not in _EXCLUDED_PARTS
                or (name in {"test", "tests"} and not exclude_tests)
            )
            and not name.startswith(".")
            and (not exclude_tests or name not in {"test", "tests"})
        ]
        base = Path(directory)
        for name in files:
            path = base / name
            if path.suffix in suffixes:
                yield path


def _has_uc_resources(template: Path) -> bool:
    config = _all_text(template, suffixes=_CONFIG_SUFFIXES)
    return (
        all(variable in config for variable in _UC_ENV)
        and re.search(r"\bexperiment", config, re.IGNORECASE) is not None
        and re.search(r"\b(?:sql_)?warehouse", config, re.IGNORECASE) is not None
    )


def _test_files(template: Path) -> list[tuple[Path, str]]:
    files = []
    for path in _iter_files(template, _SOURCE_SUFFIXES):
        relative = path.relative_to(template).as_posix().lower()
        if "test" not in relative:
            continue
        files.append((path, _read(path)))
    return files


def _has_local_conformance(template: Path) -> bool:
    for path, source in _test_files(template):
        relative = path.relative_to(template).as_posix().lower()
        if "deployed" in relative or "e2e" in relative:
            continue
        direct_contract = "assert_trace_contract" in source and re.search(
            r"mock|deterministic|inmemory", source, re.IGNORECASE
        )
        real_trace_test = re.search(
            r"search_traces|InMemoryTraceManager|withAgentRequestTrace|InMemorySpanExporter",
            source,
        ) and re.search(
            r"monkeypatch|MockTransport|jest\.mock|vi\.mock|inmemory|stub",
            source,
            re.IGNORECASE,
        )
        if direct_contract or real_trace_test:
            return True
    return False


def _has_deployed_verification(template: Path) -> bool:
    for path, source in _test_files(template):
        relative = path.relative_to(template).as_posix().lower()
        if "deployed" not in relative and "e2e" not in relative:
            continue
        has_invoke = re.search(r"invoke|request|fetch|post", source, re.IGNORECASE)
        has_trace = re.search(r"trace_id|traceId|get_trace|getTrace", source)
        has_uc = re.search(
            r"otel_spans|otelSpans|query_otel|Unity Catalog|\bUC\b", source
        )
        if has_invoke and has_trace and has_uc:
            return True
    return False


def _local_test_command(template: Path) -> tuple[str, ...] | None:
    if (template / "pyproject.toml").exists() and (
        template / "tests/test_tracing.py"
    ).exists():
        command = [
            "uv",
            "run",
            "--offline",
            "--project",
            template.name,
            "pytest",
            f"{template.name}/tests/test_tracing.py",
            "-v",
        ]
        if "pytest-xdist" in (template / "pyproject.toml").read_text():
            command.append("-n0")
        return tuple(command)
    if (template / "package.json").exists() and (
        template / "tests/framework/tracing.test.ts"
    ).exists():
        return (
            "npm",
            "test",
            "--",
            "--runInBand",
            "tests/framework/tracing.test.ts",
            "tests/framework/endpoints.test.ts",
        )
    return None


def discover_agentic_templates(root: Path | str) -> list[AgentTemplate]:
    root = Path(root)
    discovered = []
    for template in sorted(path for path in root.iterdir() if path.is_dir()):
        signals = _signals(_production_source(template))
        if not signals:
            continue
        discovered.append(
            AgentTemplate(
                name=template.name,
                path=template,
                signals=signals,
                has_uc_resources=_has_uc_resources(template),
                has_local_conformance=_has_local_conformance(template),
                has_deployed_verification=_has_deployed_verification(template),
                local_test_command=_local_test_command(template),
            )
        )
    return discovered


def assert_template_policy(templates: list[AgentTemplate]) -> None:
    failures = []
    for template in templates:
        missing = []
        if not template.has_uc_resources:
            missing.append("UC resources")
        if not template.has_local_conformance:
            missing.append("deterministic local conformance")
        if not template.has_deployed_verification:
            missing.append("deployed verification")
        if missing:
            failures.append(f"{template.name}: missing {', '.join(missing)}")
    if failures:
        raise AssertionError("Agent template policy failed:\n" + "\n".join(failures))
