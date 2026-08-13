from __future__ import annotations

import mlflow

from contract import TraceManifest, assert_trace_contract
from normalize import normalize_python_mlflow_trace


def retrieve_remote_trace(request_id: str) -> TraceManifest:
    """Retrieve and validate the exact trace returned by the remote endpoint."""
    if not request_id:
        raise AssertionError("remote agent response did not return trace identity")
    trace = mlflow.get_trace(request_id, flush=True)
    if trace is None:
        raise AssertionError(f"remote trace {request_id!r} was not found in MLflow")
    manifest = normalize_python_mlflow_trace("e2e-chatbot-app", trace)
    if manifest.trace_id != request_id:
        raise AssertionError(
            f"remote response trace {request_id!r} != retrieved MLflow trace "
            f"{manifest.trace_id!r}"
        )
    assert_trace_contract(manifest)
    return manifest


def verify_remote_trace(
    request_id: str,
    mlflow_manifest: TraceManifest,
    uc_manifest: TraceManifest,
) -> None:
    """Validate the remote agent trace returned by the production endpoint call."""
    if not request_id:
        raise AssertionError("remote agent response did not return trace identity")
    if mlflow_manifest.trace_id != request_id:
        raise AssertionError(
            f"remote response trace {request_id!r} != MLflow trace {mlflow_manifest.trace_id!r}"
        )
    if uc_manifest.trace_id != request_id:
        raise AssertionError(
            f"remote response trace {request_id!r} != UC trace {uc_manifest.trace_id!r}"
        )
    assert_trace_contract(mlflow_manifest)
    assert_trace_contract(uc_manifest)
    mlflow_ids = [span.span_id for span in mlflow_manifest.spans]
    uc_ids = [span.span_id for span in uc_manifest.spans]
    if sorted(mlflow_ids) != sorted(uc_ids):
        raise AssertionError("remote MLflow and UC span identities differ")
