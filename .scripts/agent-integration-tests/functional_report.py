"""Render functional e2e results as markdown."""
from __future__ import annotations

_MARK = {"pass": "✅ pass", "fail": "❌ FAIL", "skip": "⏭ skip"}


def render_functional_report(rows: list[dict]) -> str:
    total = len(rows)
    local_pass = sum(1 for r in rows if r.get("local") == "pass")
    dep_pass = sum(1 for r in rows if r.get("deployed") == "pass")
    lines = [
        "# Functional E2E Report", "",
        f"**{local_pass}/{total} local passed**, **{dep_pass}/{total} deployed passed**", "",
        "| Template | Family | Local | Deployed | Notes |",
        "| --- | --- | --- | --- | --- |",
    ]
    def sort_key(r):
        return ("fail" not in (r.get("local"), r.get("deployed")), r["template"])
    for r in sorted(rows, key=sort_key):
        lines.append(
            f"| {r['template']} | {r['family']} | "
            f"{_MARK.get(r.get('local'),'—')} | {_MARK.get(r.get('deployed'),'—')} | {r.get('notes','')} |"
        )
    lines.append("")
    return "\n".join(lines)
