"""Pure source transforms + parsing for deploy validation."""
from __future__ import annotations

import re
from urllib.parse import urljoin

import yaml


def neutralize_app_yaml(text: str) -> str:
    """Make an app.yaml deployable on a generic shared app.

    - Every env entry using ``valueFrom`` becomes ``value: "placeholder"``.
    - The top-level ``resources`` block is removed (it binds app resources
      that the shared validation app does not have).
    """
    doc = yaml.safe_load(text) or {}
    doc.pop("resources", None)
    for entry in doc.get("env", []) or []:
        if "valueFrom" in entry:
            entry.pop("valueFrom")
            entry["value"] = "placeholder"
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
