"""Pure source transforms + parsing for deploy validation."""
from __future__ import annotations

import json
import re
from urllib.parse import urljoin

import yaml


def neutralize_app_yaml(text: str) -> str:
    """Make an app.yaml deployable on a resource-less shared app (legacy).

    - Every env entry using ``valueFrom`` becomes ``value: "placeholder"``.
    - The top-level ``resources`` block is removed.

    Only use this when the shared app has NO resources bound. When the shared
    app has the resource keys the templates expect, use
    :func:`resource_aware_app_yaml` instead so the ``valueFrom`` refs resolve.
    """
    doc = yaml.safe_load(text) or {}
    doc.pop("resources", None)
    for entry in doc.get("env", []) or []:
        if "valueFrom" in entry:
            entry.pop("valueFrom")
            entry["value"] = "placeholder"
    return yaml.safe_dump(doc, sort_keys=False, default_flow_style=False)


# Template resource keys that name the same kind of resource as one of the
# shared app's bound keys (see validation-config.yaml) under another name.
RESOURCE_KEY_ALIASES = {"files": "uc-volume"}


def resource_aware_app_yaml(text: str) -> str:
    """Prepare an app.yaml for a shared app that HAS the expected resources bound.

    Preserves ``env`` (including every ``valueFrom`` ref, so the shared app's
    bound resources resolve; refs in RESOURCE_KEY_ALIASES are renamed to the
    shared app's key) and only drops a top-level ``resources`` block — resource
    bindings are owned by the shared app's own config, not the deployed source,
    so a source-level block would conflict.
    """
    doc = yaml.safe_load(text) or {}
    doc.pop("resources", None)
    for entry in doc.get("env") or []:
        ref = entry.get("valueFrom")
        if ref in RESOURCE_KEY_ALIASES:
            entry["valueFrom"] = RESOURCE_KEY_ALIASES[ref]
    return yaml.safe_dump(doc, sort_keys=False, default_flow_style=False)


_ASSET_RE = re.compile(
    r'(?:src|href)\s*=\s*["\']([^"\']+\.(?:js|css))(?:\?[^"\']*)?["\']',
    re.IGNORECASE,
)


def parse_spa_assets(html: str, base_url: str) -> list[str]:
    """Extract referenced .js/.css asset URLs from served HTML, absolutized."""
    seen: dict[str, None] = {}
    for ref in _ASSET_RE.findall(html):
        url = ref if ref.startswith(("http://", "https://")) else urljoin(base_url + "/", ref)
        seen.setdefault(url, None)
    return list(seen)


def parse_mcp_response(body: str) -> dict:
    """Return the JSON-RPC message in an MCP streamable-HTTP response body.

    The server answers either `application/json` (the message itself) or
    `text/event-stream` (one or more `data: {...}` lines). For SSE, the last
    message carrying a `result` or `error` is the reply. Pure, so unit-testable.
    """
    text = (body or "").strip()
    if text.startswith("{"):
        return json.loads(text)
    reply: dict = {}
    for line in text.splitlines():
        if line.startswith("data:"):
            data = line[len("data:"):].strip()
            if not data:
                continue
            msg = json.loads(data)
            if "result" in msg or "error" in msg:
                reply = msg
    if not reply:
        raise ValueError(f"no JSON-RPC reply in MCP response: {text[:300]}")
    return reply


def _unwrap_json_strings(value, depth: int = 0):
    """Replace every string that holds a JSON object/array with the parsed value.

    MCP tools often return their payload as a JSON string (`content[].text`), and
    a tool that calls an HTTP API may nest the API's own body as a JSON string in
    turn, so unwrap recursively (bounded) before matching.
    """
    if depth > 5:
        return value
    if isinstance(value, str):
        s = value.strip()
        if s[:1] in ("{", "["):
            try:
                return _unwrap_json_strings(json.loads(s), depth + 1)
            except ValueError:
                return value
        return value
    if isinstance(value, dict):
        return {k: _unwrap_json_strings(v, depth) for k, v in value.items()}
    if isinstance(value, list):
        return [_unwrap_json_strings(v, depth) for v in value]
    return value


def mcp_result_text(reply: dict) -> str:
    """A searchable text form of a JSON-RPC tools/call reply.

    Tools return their payload as `structuredContent` and/or as JSON inside
    `content[].text`, sometimes with further JSON nested in string fields. Unwrap
    all of it and re-encode with ``json.dumps`` defaults, so a config `expect` like
    ``'"ok": true'`` matches regardless of nesting or the server's spacing. Plain
    (non-JSON) text, e.g. a tool error message, is kept as-is.
    """
    body = reply.get("result", reply.get("error")) or {}
    return json.dumps(_unwrap_json_strings(body))


def app_yaml_from_bundle(databricks_yml: str) -> str | None:
    """Build an app.yaml from a bundle's (single) app `config`, or None if it has none.

    Bundle-only templates (no app.yaml) can't be deployed to the shared app by a
    source deploy, which reads the run command and env from app.yaml. Their
    databricks.yml carries the same thing under resources.apps.<key>.config, so
    write it out — `value_from` becomes app.yaml's `valueFrom`, which resolves
    against the shared app's resource keys like any other template's.
    """
    cfg = yaml.safe_load(databricks_yml) or {}
    apps = ((cfg.get("resources") or {}).get("apps") or {})
    if len(apps) != 1:
        return None
    config = (next(iter(apps.values())) or {}).get("config") or {}
    if not config.get("command"):
        return None
    env = []
    for entry in config.get("env") or []:
        entry = dict(entry)
        if "value_from" in entry:
            entry["valueFrom"] = entry.pop("value_from")
        env.append(entry)
    return yaml.safe_dump({"command": config["command"], "env": env}, sort_keys=False)
