"""Which MCP services this virtual server combines, and which of their tools it exposes.

Sources, highest precedence first:

1. ``VIRTUAL_MCP_CONFIG``: the config as inline JSON (handy for local development).
2. ``virtual_mcp_config.json`` in the Unity Catalog volume bound as the ``uc-volume``
   app resource (``VIRTUAL_MCP_CONFIG_VOLUME`` holds its ``/Volumes/...`` path).
3. The ``virtual_mcp_config.json`` bundled with this template, when no volume is bound
   or the volume has no such file.

The volume is read once at startup, in a worker thread: a slow or rate-limited Unity
Catalog must never block request handling. Until it is read, and if it can't be read,
no services are exposed, rather than tools the volume's config may have excluded.
Restart the app after editing the file.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path

from databricks.sdk import WorkspaceClient
from databricks.sdk.config import Config
from databricks.sdk.errors import NotFound

log = logging.getLogger(__name__)

CONFIG_FILE_NAME = "virtual_mcp_config.json"
BUNDLED_CONFIG_PATH = Path(__file__).resolve().parent.parent / CONFIG_FILE_NAME
# Service names go into upstream URL paths, so allow only plain three-part names.
_SERVICE_NAME = re.compile(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")
# Tool names are "<alias>__<tool>" and routing splits on the first "__".
_ALIAS = re.compile(r"[a-z0-9]+(_[a-z0-9]+)*")


@dataclass
class ServiceSelection:
    """One MCP service and the subset of its tools to expose."""

    # Three-level Unity Catalog name, e.g. "system.ai.github".
    name: str
    # Prefix of this service's tools in the merged namespace ("github" ->
    # "github__search_issues"). Derived from the name when omitted.
    alias: str = ""
    # A tool is exposed if it is listed in include_tools or matches include_regex.
    # With neither set, every tool of the service is exposed.
    include_tools: list[str] = field(default_factory=list)
    include_regex: str = ""

    def __post_init__(self) -> None:
        self._pattern = (
            re.compile(self.include_regex, re.IGNORECASE) if self.include_regex else None
        )

    def matches(self, tool_name: str) -> bool:
        if not self.include_tools and self._pattern is None:
            return True
        if tool_name in self.include_tools:
            return True
        return bool(self._pattern and self._pattern.search(tool_name))


@dataclass
class VirtualMcpConfig:
    services: list[ServiceSelection] = field(default_factory=list)
    # Where the config was loaded from; shown in the UI.
    source: str = ""

    def by_alias(self, alias: str) -> ServiceSelection | None:
        return next((s for s in self.services if s.alias == alias), None)


def _derive_alias(name: str, taken: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", name.split(".")[-1].lower()).strip("_") or "service"
    alias, n = base, 2
    while alias in taken:
        alias, n = f"{base}{n}", n + 1
    return alias


def _parse_service(entry: object, where: str) -> ServiceSelection:
    if not isinstance(entry, dict):
        raise ValueError(f"{where}: expected an object")
    unknown = set(entry) - {"name", "alias", "include_tools", "include_regex"}
    if unknown:
        raise ValueError(f"{where}: unknown fields {sorted(unknown)}")
    name = entry.get("name")
    if not isinstance(name, str) or not _SERVICE_NAME.fullmatch(name):
        raise ValueError(f"{where}: 'name' must be a catalog.schema.service name")
    alias = entry.get("alias", "")
    if not isinstance(alias, str) or (alias and not _ALIAS.fullmatch(alias)):
        raise ValueError(
            f"{where}: 'alias' must be lowercase letters, digits and single underscores"
        )
    tools = entry.get("include_tools", [])
    if not isinstance(tools, list) or not all(isinstance(t, str) for t in tools):
        raise ValueError(f"{where}: 'include_tools' must be a list of tool names")
    regex = entry.get("include_regex", "")
    if not isinstance(regex, str):
        raise ValueError(f"{where}: 'include_regex' must be a string")
    try:
        return ServiceSelection(name=name, alias=alias, include_tools=tools, include_regex=regex)
    except re.error as e:
        raise ValueError(f"{where}: invalid include_regex: {e}") from e


def parse_config(raw: object, source: str) -> VirtualMcpConfig:
    """Validate a config document. Raises ValueError with a readable message."""
    entries = raw.get("services") if isinstance(raw, dict) else None
    if not isinstance(entries, list):
        raise ValueError(f"{source}: expected a top-level 'services' list")
    services = [_parse_service(e, f"{source}: services[{i}]") for i, e in enumerate(entries)]
    taken = {s.alias for s in services if s.alias}
    if len(taken) != sum(1 for s in services if s.alias):
        raise ValueError(f"{source}: aliases must be unique")
    for s in services:
        if not s.alias:
            s.alias = _derive_alias(s.name, taken)
            taken.add(s.alias)
    return VirtualMcpConfig(services=services, source=source)


_lock = threading.Lock()
_current: VirtualMcpConfig | None = None


def _bundled_config() -> VirtualMcpConfig:
    return parse_config(json.loads(BUNDLED_CONFIG_PATH.read_text()), "bundled default")


def _volume_path() -> str | None:
    if os.environ.get("VIRTUAL_MCP_CONFIG", "").strip():
        return None
    volume = os.environ.get("VIRTUAL_MCP_CONFIG_VOLUME", "").strip().rstrip("/")
    return f"{volume}/{CONFIG_FILE_NAME}" if volume else None


def _local_config() -> VirtualMcpConfig:
    inline = os.environ.get("VIRTUAL_MCP_CONFIG", "").strip()
    if inline:
        return parse_config(json.loads(inline), "VIRTUAL_MCP_CONFIG")
    path = _volume_path()
    if path:
        return VirtualMcpConfig(source=f"loading {path}")
    return _bundled_config()


def load() -> VirtualMcpConfig:
    """The active config. Never does network I/O."""
    global _current
    with _lock:
        if _current is None:
            _current = _local_config()
        return _current


def _set(cfg: VirtualMcpConfig) -> None:
    global _current
    with _lock:
        _current = cfg


def refresh_from_volume() -> None:
    """Load the bound volume's config. Blocking: run it in a worker thread."""
    path = _volume_path()
    if not path:
        return
    # Bounded retries: an unbounded SDK retry loop against a throttled Unity Catalog
    # would keep the app serving nothing for many minutes without saying why.
    client = WorkspaceClient(config=Config(retry_timeout_seconds=30, http_timeout_seconds=15))
    try:
        loaded = parse_config(json.loads(client.files.download(path).contents.read()), path)
    except NotFound:
        log.warning("%s not found; using the bundled default config", path)
        _set(_bundled_config())
        return
    except Exception as e:  # noqa: BLE001 -- any failure must be visible, not a silent default
        log.error("could not load %s: %s", path, e)
        _set(VirtualMcpConfig(source=f"error loading {path}: {e}"))
        return
    _set(loaded)
    log.info("loaded %d services from %s", len(loaded.services), path)
