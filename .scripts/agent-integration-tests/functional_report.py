"""Render functional e2e results as markdown."""
from __future__ import annotations

_MARK = {"pass": "✅ pass", "fail": "❌ FAIL", "skip": "⏭ skip"}


def _counts(rows: list[dict], key: str) -> dict:
    c = {"pass": 0, "fail": 0, "skip": 0}
    for r in rows:
        c[r.get(key, "skip")] = c.get(r.get(key, "skip"), 0) + 1
    return c


def _target_ran(c: dict) -> bool:
    # A target that produced no pass or fail was never exercised (every row
    # defaults to "skip"); treat it as "not run" rather than "all skipped".
    return c["pass"] > 0 or c["fail"] > 0


def _summary(c: dict) -> str:
    if not _target_ran(c):
        return "not run"
    return f"{c['pass']} passed · {c['skip']} skipped · {c['fail']} failed"


def render_functional_report(rows: list[dict]) -> str:
    local, dep = _counts(rows, "local"), _counts(rows, "deployed")
    local_ran, dep_ran = _target_ran(local), _target_ran(dep)
    verdict = "✅ no failures" if local["fail"] == 0 and dep["fail"] == 0 else "❌ failures present"
    lines = [
        "# Functional E2E Report", "",
        f"**Local:** {_summary(local)}  ",
        f"**Deployed:** {_summary(dep)}", "",
        verdict, "",
        "| Template | Family | Local | Deployed | Notes |",
        "| --- | --- | --- | --- | --- |",
    ]

    def cell(r, key, ran):
        return _MARK.get(r.get(key), "—") if ran else "–"

    def sort_key(r):
        return ("fail" not in (r.get("local"), r.get("deployed")), r["template"])

    for r in sorted(rows, key=sort_key):
        lines.append(
            f"| {r['template']} | {r['family']} | "
            f"{cell(r, 'local', local_ran)} | {cell(r, 'deployed', dep_ran)} | {r.get('notes','')} |"
        )
    lines.append("")
    return "\n".join(lines)
