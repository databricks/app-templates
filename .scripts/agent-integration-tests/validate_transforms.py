"""Pure source transforms + parsing for deploy validation."""
from __future__ import annotations

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


def resource_aware_app_yaml(text: str) -> str:
    """Prepare an app.yaml for a shared app that HAS the expected resources bound.

    Preserves ``env`` (including every ``valueFrom`` ref, so the shared app's
    bound resources resolve) and only drops a top-level ``resources`` block —
    resource bindings are owned by the shared app's own config, not the deployed
    source, so a source-level block would conflict.
    """
    doc = yaml.safe_load(text) or {}
    doc.pop("resources", None)
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
