"""Every MLflow and Databricks call the app makes. Template-owned.

The rest of the template works with plain dicts from this class, so tests swap it for a fake.
Calls run as the app's service principal, except `run_sql_as_user`.
"""

from __future__ import annotations

import functools
import os
from typing import Any

import mlflow
import mlflow.genai.databricks.review_queues as rq
from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import DatabricksError
from databricks.sdk.service.sql import ExecuteStatementRequestOnWaitTimeout
from mlflow.entities import AssessmentSource, AssessmentSourceType, Expectation, Feedback
from mlflow.exceptions import MlflowException

_INPUTS = {
    rq.InputPassFail: "pass_fail",
    rq.InputCategorical: "categorical",
    rq.InputNumeric: "numeric",
    rq.InputText: "text",
}


class UpstreamError(Exception):
    """MLflow or Databricks refused a call, for example a missing grant. The API answers 502."""


def _upstream(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except (MlflowException, DatabricksError) as e:
            raise UpstreamError(str(e)) from e

    return wrapper


def _all(list_fn, *args, **kwargs) -> list:
    out, token = [], None
    while True:
        page = list_fn(*args, page_token=token, **kwargs)
        out.extend(page)
        token = page.token
        if not token:
            return out


def _assessment(a) -> dict[str, Any]:
    value = a.feedback if a.feedback is not None else a.expectation
    return {
        "assessment_id": a.assessment_id,
        "assessment_name": a.name,
        "valid": a.valid,
        "source": {"source_type": str(a.source.source_type), "source_id": a.source.source_id},
        "value": getattr(value, "value", None),
        "rationale": a.rationale,
        "create_time_ms": a.create_time_ms,
    }


class MlflowGateway:
    def __init__(self, experiment_id: str, warehouse_id: str | None):
        self.exp = experiment_id
        self.warehouse_id = warehouse_id
        mlflow.set_tracking_uri("databricks")
        if warehouse_id:
            # Reads and writes of Unity Catalog traces go through this warehouse.
            os.environ["MLFLOW_TRACING_SQL_WAREHOUSE_ID"] = warehouse_id
        self._ws: WorkspaceClient | None = None

    @property
    def ws(self) -> WorkspaceClient:
        if self._ws is None:
            self._ws = WorkspaceClient()
        return self._ws

    # ---- review queues ----

    @_upstream
    def list_queues(self) -> list[dict]:
        return [
            {
                "id": q.queue_id,
                "display_name": q.display_name,
                "queue_type": str(q.queue_type),
                "pending_item_count": q.pending_item_count,
                "total_item_count": q.total_item_count,
            }
            for q in _all(rq.list_review_queues, self.exp)
        ]

    @_upstream
    def list_members(self, queue_id: str) -> list[str]:
        return [m.user for m in _all(rq.list_review_queue_members, self.exp, queue_id)]

    @_upstream
    def list_items(self, queue_id: str, status: str | None = None) -> list[dict]:
        return [
            {
                "id": i.item_id,
                "status": str(i.status),
                "kind": str(i.kind),
                "trace_id": i.trace_id,
                "completed_by": i.completed_by,
            }
            for i in _all(rq.list_review_queue_items, self.exp, queue_id, status=status)
        ]

    @_upstream
    def questions(self, queue_id: str) -> list[dict]:
        out = []
        for q in rq.resolve_effective_review_questions(self.exp, queue_id, item_kind="V4_TRACE"):
            d = {
                "title": q.title,
                "type": str(q.type) if q.type else None,
                "instruction": q.instruction,
                "enable_comment": q.enable_comment,
            }
            if q.input is not None:
                d[_INPUTS[type(q.input)]] = q.input.to_dict()
            out.append(d)
        return out

    @_upstream
    def set_status(self, queue_id: str, item_id: str, status: str) -> dict:
        i = rq.set_review_queue_item_status(self.exp, queue_id, item_id, status)
        return {"id": i.item_id, "status": str(i.status), "trace_id": i.trace_id, "completed_by": i.completed_by}

    # ---- traces and answers ----

    @_upstream
    def experiment_tags(self) -> dict[str, str]:
        return dict(mlflow.get_experiment(self.exp).tags)

    @_upstream
    def get_trace(self, location: str, trace_id: str) -> dict | None:
        trace = mlflow.get_trace(f"trace:/{location}/{trace_id}")
        if trace is None:
            return None
        info = trace.info.to_dict()
        info.pop("assessments", None)
        return {
            "trace_info": info,
            "spans": [s.to_dict() for s in trace.data.spans],
            "assessments": [_assessment(a) for a in trace.info.assessments],
        }

    @_upstream
    def log_answer(
        self,
        location: str,
        trace_id: str,
        *,
        name: str,
        kind: str,
        value: Any,
        rationale: str | None,
        reviewer: str,
        overrides: str | None,
    ) -> None:
        source = AssessmentSource(source_type=AssessmentSourceType.HUMAN, source_id=reviewer)
        if kind == "expectation":
            a = Expectation(name=name, value=value, source=source)
            a.rationale, a.overrides = rationale, overrides
        else:
            a = Feedback(name=name, value=value, source=source, rationale=rationale, overrides=overrides)
        mlflow.log_assessment(trace_id=f"trace:/{location}/{trace_id}", assessment=a)

    # ---- /setup ----

    @_upstream
    def service_principal(self) -> str:
        me = self.ws.current_user.me()
        return me.user_name or me.id or ""

    @_upstream
    def first_queue(self) -> str | None:
        page = rq.list_review_queues(self.exp, max_results=1)
        return page[0].queue_id if len(page) else None

    @_upstream
    def check_members(self, queue_id: str) -> None:
        rq.list_review_queue_members(self.exp, queue_id, max_results=1)

    @_upstream
    def check_warehouse(self) -> None:
        self.ws.warehouses.get(self.warehouse_id)

    @_upstream
    def privileges(self, kind: str, name: str, principal: str) -> set[str]:
        """Includes grants the principal gets through groups and from parent objects."""
        res = self.ws.grants.get_effective(securable_type=kind, full_name=name, principal=principal)
        return {
            getattr(p.privilege, "value", p.privilege)
            for a in res.privilege_assignments or []
            for p in a.privileges or []
        }

    @_upstream
    def owner(self, kind: str, name: str) -> str:
        getter = {"catalog": self.ws.catalogs.get, "schema": self.ws.schemas.get, "table": self.ws.tables.get}[kind]
        return getter(name).owner or ""

    def _as_user(self, user_token: str) -> WorkspaceClient:
        return WorkspaceClient(host=self.ws.config.host, token=user_token, auth_type="pat")

    def run_sql_as_user(self, user_token: str, statement: str) -> tuple[bool, str | None]:
        """Runs one statement with the signed-in user's token (the app's `sql` user scope)."""
        try:
            res = self._as_user(user_token).statement_execution.execute_statement(
                statement=statement,
                warehouse_id=self.warehouse_id,
                wait_timeout="30s",
                on_wait_timeout=ExecuteStatementRequestOnWaitTimeout.CANCEL,
            )
        except DatabricksError as e:
            return False, str(e)[:300]
        state = getattr(res.status.state, "value", res.status.state) if res.status else None
        if state == "SUCCEEDED":
            return True, None
        error = res.status.error.message if res.status and res.status.error else None
        return False, error or f"Statement {state or 'did not finish'}."
