import re
import os
import json
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
    proof_owner: str | None = None


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
    explicit_agent_endpoint = re.search(
        r"(?:\.responses\.create\s*\(|/agent/v\d+/|agents/[\w./-]+)", source
    )
    trace_returning_invocation = re.search(r"/invocations\b", source) and re.search(
        r"\b(?:agent|return_trace|trace_id|traceId|request_id|requestId)\b",
        source,
        re.IGNORECASE,
    )
    if explicit_agent_endpoint or trace_returning_invocation:
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


def _production_signals(template: Path) -> tuple[str, ...]:
    observed = {
        signal
        for path in _iter_files(template, _SOURCE_SUFFIXES, exclude_tests=True)
        for signal in _signals(_read(path))
    }
    order = (
        "agent-server",
        "agent-constructor",
        "agent-endpoint",
        "model-tool-loop",
        "retrieval-generation",
    )
    return tuple(signal for signal in order if signal in observed)


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
    normalized = config.lower()
    return (
        all(variable.lower() in normalized for variable in _UC_ENV)
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
        direct_contract = re.search(
            r"assert_?Trace_?Contract", source, re.IGNORECASE
        ) and re.search(r"mock|deterministic|inmemory", source, re.IGNORECASE)
        real_trace_test = re.search(
            r"search_traces|InMemoryTraceManager|withAgentRequestTrace|InMemorySpanExporter",
            source,
        ) and re.search(
            r"monkeypatch|MockTransport|jest\.mock|vi\.mock|inmemory|stub",
            source,
            re.IGNORECASE,
        )
        sdk_hook_trace_test = "registerOnSpanEndHook" in source and re.search(
            r"spyOn|mockImplementation|loopback", source, re.IGNORECASE
        )
        if direct_contract or real_trace_test or sdk_hook_trace_test:
            return True
    return False


def _has_deployed_verification(template: Path) -> bool:
    for path, source in _test_files(template):
        relative = path.relative_to(template).as_posix().lower()
        deployed_test = (
            "deployed" in relative
            or "e2e" in relative
            or re.search(r"\b(?:def|test)\s+test_deployed", source) is not None
        )
        deployment_preflight = (
            "verify_deployment_trace_resources" in source
            and "verify_smoke_trace" in source
        )
        if not deployed_test and not deployment_preflight:
            continue
        has_invoke = re.search(r"invoke|request|fetch|post", source, re.IGNORECASE)
        has_trace = re.search(r"trace_id|traceId|get_trace|getTrace", source)
        has_uc = re.search(
            r"otel_spans|otelSpans|query_otel|unity[_ ]catalog|\bUC\b",
            source,
            re.IGNORECASE,
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
            "--frozen",
            "--project",
            template.name,
            "pytest",
            f"{template.name}/tests/test_tracing.py",
            "-v",
        ]
        if "pytest-xdist" in (template / "pyproject.toml").read_text():
            command.append("-n0")
        return tuple(command)
    nested_python_trace_tests = sorted(
        template.glob("pipelines/*/tests/test_tracing.py")
    )
    if nested_python_trace_tests:
        repository_root = template.parent
        integration_project = repository_root / ".scripts" / "agent-integration-tests"
        return (
            "uv",
            "run",
            "--offline",
            "--frozen",
            "--project",
            integration_project.relative_to(repository_root).as_posix(),
            "pytest",
            nested_python_trace_tests[0].relative_to(repository_root).as_posix(),
            "-v",
        )
    standalone_python_trace_test = template / "tests" / "test_trace_conformance.py"
    if standalone_python_trace_test.exists():
        repository_root = template.parent
        integration_project = repository_root / ".scripts" / "agent-integration-tests"
        return (
            "uv",
            "run",
            "--offline",
            "--frozen",
            "--project",
            integration_project.relative_to(repository_root).as_posix(),
            "pytest",
            standalone_python_trace_test.relative_to(repository_root).as_posix(),
            "-v",
        )
    tracing_tests = [
        path
        for path in (
            template / "server" / "tests" / "tracing.test.ts",
            template / "server" / "tests" / "tracing-real-ai-sdk.test.ts",
        )
        if path.exists()
    ]
    if (template / "package.json").exists() and tracing_tests:
        return (
            "npm",
            "test",
            "--",
            *(path.relative_to(template).as_posix() for path in tracing_tests),
        )
    proxy_trace_test = (
        template / "tests" / "routes" / "trace-id-capture.api-proxy.test.ts"
    )
    if (template / "package.json").exists() and proxy_trace_test.exists():
        return (
            "npm",
            "run",
            "test:ephemeral",
            "--",
            proxy_trace_test.relative_to(template).as_posix(),
            "--project=routes-api-proxy",
        )
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


def _generated_appkit_proof_owner(template: Path) -> str | None:
    package_path = template / "package.json"
    manifest_path = template / "appkit.plugins.json"
    server_path = template / "server" / "server.ts"
    if not all(path.exists() for path in (package_path, manifest_path, server_path)):
        return None
    try:
        package = json.loads(_read(package_path))
        manifest = json.loads(_read(manifest_path))
    except (TypeError, ValueError):
        return None
    agents = manifest.get("plugins", {}).get("agents", {})
    server = _read(server_path)
    if not (
        package.get("dependencies", {}).get("@databricks/appkit")
        and agents.get("package") == "@databricks/appkit"
        and agents.get("requiredByTemplate") is True
        and re.search(r"\bcreateApp\s*\(", server)
        and re.search(r"\bagents\s*\(", server)
    ):
        return None
    configured_owner = os.environ.get("APPKIT_SOURCE_ROOT")
    if configured_owner:
        owner_roots = [Path(configured_owner)]
    else:
        workspace_root = template.parent.parent
        owner_roots = sorted(
            (path for path in workspace_root.iterdir() if path.is_dir()),
            key=lambda path: path.name,
        )
    matches: list[Path] = []
    for owner_root in owner_roots:
        owner_suite = (
            owner_root
            / "packages/appkit/src/plugins/agents/tests/trace-conformance.integration.test.ts"
        )
        owner_generator = owner_root / "tools/generate-app-templates.ts"
        if (
            owner_suite.exists()
            and owner_generator.exists()
            and f'name: "{template.name}"' in _read(owner_generator)
        ):
            matches.append(owner_root.resolve())
    if configured_owner and matches:
        return str(matches[0])
    return str(matches[0]) if len(matches) == 1 else None


def is_trace_policy_candidate(template: AgentTemplate) -> bool:
    """Admit every executable agent behavior, without consulting proof."""
    return bool(template.signals)


def discover_agentic_templates(root: Path | str) -> list[AgentTemplate]:
    root = Path(root).resolve()
    discovered = []
    for template in sorted(
        path
        for path in root.iterdir()
        if path.is_dir() and not path.name.startswith(".")
    ):
        signals = _production_signals(template)
        if not signals:
            continue
        proof_owner = _generated_appkit_proof_owner(template)
        local_test_command = _local_test_command(template)
        if proof_owner and local_test_command is None:
            local_test_command = (
                "__appkit_generated_owner__",
                proof_owner,
                template.name,
            )
        discovered.append(
            AgentTemplate(
                name=template.name,
                path=template,
                signals=signals,
                has_uc_resources=_has_uc_resources(template),
                has_local_conformance=_has_local_conformance(template),
                has_deployed_verification=(
                    _has_deployed_verification(template) or proof_owner is not None
                ),
                local_test_command=local_test_command,
                proof_owner=proof_owner,
            )
        )
    return discovered


def assert_template_policy(templates: list[AgentTemplate]) -> None:
    failures = []
    for template in templates:
        missing = []
        if not template.has_uc_resources:
            missing.append("UC resources")
        if not template.has_local_conformance and template.local_test_command is None:
            missing.append("deterministic local conformance")
        if not template.has_deployed_verification and not template.proof_owner:
            missing.append("deployed verification")
        if missing:
            failures.append(f"{template.name}: missing {', '.join(missing)}")
    if failures:
        raise AssertionError("Agent template policy failed:\n" + "\n".join(failures))
