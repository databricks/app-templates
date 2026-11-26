"""Checks behind the /setup page: can the app's service principal do everything the app needs?

Template-owned. Each check is ok True / False, or None when the app cannot tell (for example it
may not read its own permissions); a failing or unknown check carries the fix to apply.
"""

from __future__ import annotations

import re
from typing import Any

from .backend import ReviewError
from .gateway import UpstreamError

# The trace tables and the access each needs, by the experiment tag that names it. Same tags and
# privileges the MLflow review UI grants to reviewers.
TABLE_TAGS = {
    "mlflow.experiment.databricksTraceSpanStorageTable": (["SELECT"], "Spans: read"),
    "mlflow.experiment.databricksTraceLogStorageTable": (["SELECT"], "Logs: read"),
    # Answers are written here.
    "mlflow.experiment.databricksTraceAnnotationStorageTable": (["MODIFY", "SELECT"], "Answers: read and write"),
}
# `catalog.schema.prefix`: the tables above are `<prefix>_otel_spans`, `_otel_logs` and `_otel_annotations`.
DESTINATION_TAG = "mlflow.experiment.databricksTraceDestinationPath"
TABLE_SUFFIXES = dict(zip(TABLE_TAGS, ["_otel_spans", "_otel_logs", "_otel_annotations"], strict=True))

_NAME_PART = re.compile(r"[A-Za-z0-9_-]{1,255}")
_PRINCIPAL = re.compile(r"[A-Za-z0-9@._+-]{1,255}")


def _short(e: Exception, n: int = 300) -> str:
    return str(e)[:n]


def _quote(name: str) -> str:
    # Table names come from experiment tags, which editors can change, so allow only plain names.
    parts = name.split(".")
    if not all(_NAME_PART.fullmatch(p) for p in parts):
        raise ReviewError(f"Unexpected Unity Catalog name {name}.")
    return ".".join(f"`{p}`" for p in parts)


def grant_sql(kind: str, name: str, privileges: list[str], principal: str) -> str:
    if not _PRINCIPAL.fullmatch(principal):
        raise ReviewError("Unexpected service principal name.")
    privs = ", ".join(sorted(privileges)).replace("_", " ")
    return f"GRANT {privs} ON {kind.upper()} {_quote(name)} TO `{principal}`"


def trace_tables(tags: dict[str, str], pinned: str | None) -> list[tuple[str, list[str]]]:
    """The trace tables the app needs: (name, privileges).

    Experiment editors can change the tags that name these tables. So the tables must be the ones of
    `pinned` (TRACE_DESTINATION in app.yaml), which only app editors can change; otherwise an
    experiment editor could choose what an admin's Grant click grants.
    """
    tables = [(tag, tags[tag], privs) for tag, (privs, _) in TABLE_TAGS.items() if tags.get(tag)]
    if not tables:
        return []
    destination = tags.get(DESTINATION_TAG, "")
    if len(destination.split(".")) != 3:
        raise ReviewError("The experiment's trace destination is not a Unity Catalog `catalog.schema.prefix`.")
    if not pinned:
        raise PinError(f"Set TRACE_DESTINATION in app.yaml to {destination} and redeploy the app.")
    if destination != pinned:
        raise PinError(
            f"The experiment's trace destination is {destination}, but app.yaml sets TRACE_DESTINATION to "
            f"{pinned}. If {destination} is right, change TRACE_DESTINATION and redeploy the app."
        )
    for tag, name, _ in tables:
        if name != f"{destination}{TABLE_SUFFIXES[tag]}":
            raise ReviewError(f"{name} is not a trace table of {destination}; check the experiment tag {tag}.")
    return [(name, privs) for _, name, privs in tables]


class PinError(ReviewError):
    """The trace destination is not pinned, or the experiment no longer matches the pin."""


def trace_securables(tags: dict[str, str], pinned: str | None) -> list[tuple[str, str, list[str]]]:
    """Every catalog, schema and trace table the app needs: (kind, name, privileges)."""
    tables = trace_tables(tags, pinned)
    schemas = sorted({t.rsplit(".", 1)[0] for t, _ in tables})
    catalogs = sorted({s.split(".")[0] for s in schemas})
    return (
        [("catalog", c, ["USE_CATALOG"]) for c in catalogs]
        + [("schema", s, ["USE_SCHEMA"]) for s in schemas]
        + [("table", t, privs) for t, privs in tables]
    )


def _label(kind: str, name: str, tags: dict[str, str]) -> str:
    if kind != "table":
        return kind.capitalize()
    return next((label for tag, (_, label) in TABLE_TAGS.items() if tags.get(tag) == name), "Table")


def _parents(kind: str, name: str) -> list[tuple[str, str]]:
    """The securable and the ones above it: a table, its schema, its catalog."""
    parts = name.split(".")
    chain = [("catalog", parts[0])]
    if kind != "catalog":
        chain.append(("schema", ".".join(parts[:2])))
    if kind == "table":
        chain.append(("table", name))
    return chain


def can_user_grant(gw, kind: str, name: str, user: str) -> dict[str, Any]:
    """Whether `user` may grant on this securable, and the owner to ask if not.

    A user may grant if they own it or anything above it, or have MANAGE on it. Only says False when
    every owner is someone else and MANAGE is absent; a group owner or an unreadable answer gives no
    answer, so the page never blocks on a guess.
    """
    try:
        owners = [gw.owner(k, n) for k, n in _parents(kind, name)]
        if any(o.lower() == user.lower() for o in owners):
            return {"can": True}
        if "MANAGE" in gw.privileges(kind, name, user):
            return {"can": True}
    except UpstreamError:
        return {}
    owner = owners[-1]
    # An owner that is not an email may be a group the user belongs to: do not guess.
    return {"owner": owner} if any("@" not in o for o in owners) else {"can": False, "owner": owner}


def run_checks(gw, user: str | None = None, pinned: str | None = None) -> dict[str, Any]:
    checks: list[dict] = []

    def resource_fix(what: str, how: str) -> str:
        return f"Edit the app, open App resources, and add the {what} resource ({how})."

    experiment_fix = resource_fix("experiment", "key `experiment`, Can edit")
    warehouse_fix = resource_fix("SQL warehouse", "key `sql-warehouse`, Can use")

    # Each check reports its own failure, so the page shows all of them.
    def check(name: str, fn, fix: str):
        try:
            result = fn()
        except UpstreamError as e:
            checks.append({"name": name, "group": "resources", "ok": False, "detail": _short(e), "fix": fix})
            return None
        checks.append({"name": name, "group": "resources", "ok": True})
        return result if result is not None else True

    sp = gw.service_principal()
    exp_tags = check("Read the experiment", gw.experiment_tags, experiment_fix)
    first = check("List review queues", gw.first_queue, experiment_fix)
    if isinstance(first, str):
        check("List queue members", lambda: gw.check_members(first), experiment_fix)
    if gw.warehouse_id:
        check("Use the SQL warehouse", gw.check_warehouse, warehouse_fix)
    else:
        checks.append(
            {
                "name": "Use the SQL warehouse",
                "group": "resources",
                "ok": False,
                "detail": "No warehouse is set.",
                "fix": warehouse_fix,
            }
        )

    tags = exp_tags if isinstance(exp_tags, dict) else {}
    try:
        securables = trace_securables(tags, pinned)
    except PinError as e:
        checks.append({"name": "Trace destination", "group": "access", "ok": False, "fix": str(e)})
        return {"service_principal": sp, "trace_destination": pinned, "checks": checks}
    except ReviewError as e:
        location_fix = "Use an experiment whose traces are stored in Unity Catalog, and don't edit its trace tags."
        checks.append(
            {
                "name": "Unity Catalog trace location",
                "group": "access",
                "ok": False,
                "detail": str(e),
                "fix": location_fix,
            }
        )
        return {"service_principal": sp, "trace_destination": pinned, "checks": checks}
    if not securables:
        if exp_tags is not None:
            checks.append(
                {
                    "name": "Unity Catalog trace location",
                    "group": "access",
                    "ok": False,
                    "detail": "This experiment does not store traces in Unity Catalog.",
                    "fix": "Use an experiment whose traces are stored in Unity Catalog.",
                }
            )
        return {"service_principal": sp, "trace_destination": pinned, "checks": checks}

    for kind, name, privs in securables:
        base = {
            "name": f"{', '.join(privs)} on {name}",
            "group": "access",
            "label": _label(kind, name, tags),
            "object": name,
        }
        fix = f"{grant_sql(kind, name, privs, sp)};"
        try:
            have = gw.privileges(kind, name, sp)
        except UpstreamError as e:
            checks.append(
                {**base, "ok": None, "detail": f"Could not read the permissions: {_short(e, 200)}", "fix": fix}
            )
            continue
        if "ALL_PRIVILEGES" in have or all(p in have for p in privs):
            checks.append({**base, "ok": True})
            continue
        # Warn before the Grant click if the signed-in user cannot grant this.
        grant = can_user_grant(gw, kind, name, user) if user else {}
        checks.append(
            {
                **base,
                "ok": False,
                "detail": f"Has: {', '.join(sorted(have)) or 'nothing'}.",
                "fix": fix,
                **({"you_can_grant": grant["can"]} if "can" in grant else {}),
                **({"owner": grant["owner"]} if grant.get("owner") else {}),
            }
        )
    return {"service_principal": sp, "trace_destination": pinned, "checks": checks}


def run_grants(gw, user_token: str, pinned: str | None) -> dict[str, Any]:
    """Runs the GRANTs as the signed-in user, so the service principal gets the trace tables.

    Grants only the tables of the pinned trace destination (see `trace_tables`). UC accepts a GRANT
    only from someone who may manage that securable, so a user without that right gets a per-grant
    error.
    """
    if not gw.warehouse_id:
        raise ReviewError("No SQL warehouse is set; add the sql-warehouse resource first.")
    sp = gw.service_principal()
    securables = trace_securables(gw.experiment_tags(), pinned)
    if not securables:
        raise ReviewError("This experiment does not store traces in Unity Catalog.")
    statements = [grant_sql(k, n, p, sp) for k, n, p in securables]  # validate every name before any GRANT runs
    results = []
    for statement in statements:
        ok, detail = gw.run_sql_as_user(user_token, statement)
        results.append(
            {"statement": statement, "ok": True} if ok else {"statement": statement, "ok": False, "detail": detail}
        )
    return {"service_principal": sp, "results": results}
