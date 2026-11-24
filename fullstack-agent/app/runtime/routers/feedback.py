"""Record the signed-in user's rating of an answer on its run's trace."""

import asyncio
import logging

import mlflow
from fastapi import APIRouter, HTTPException, Request
from mlflow.entities import AssessmentSource, AssessmentSourceType
from mlflow.exceptions import MlflowException

from runtime import stores
from runtime.auth import SignedIn
from runtime.schemas import FeedbackRequest

FEEDBACK_NAME = "user_feedback"
RUN_NOT_FOUND = "Answer not found. Rate an answer in one of your conversations."
NOT_RECORDED = "We couldn't record your rating. Try again in a few minutes."
logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/feedback", status_code=204)
async def feedback(body: FeedbackRequest, request: Request, caller: SignedIn) -> None:
    """Log caller's rating on run's trace as app identity."""
    await asyncio.to_thread(stores.owned, caller, body.conversation_id)
    session_id = caller.store_session_id(body.conversation_id)
    trace_id = await stores.run_trace_id(request.app, session_id, body.run_id)
    if trace_id is None:
        raise HTTPException(404, RUN_NOT_FOUND)
    source = AssessmentSource(
        source_type=AssessmentSourceType.HUMAN, source_id=caller.email
    )
    try:
        await asyncio.to_thread(
            rate, trace_id, body.helpful, body.comment or None, source
        )
    except MlflowException as error:
        logger.error("Feedback not logged", extra={"code": error.error_code})
        raise HTTPException(502, NOT_RECORDED) from error
    logger.info("Feedback logged", extra={"helpful": body.helpful})


def rate(
    trace_id: str, helpful: bool, rationale: str | None, source: AssessmentSource
) -> None:
    """Override source's current rating on the trace, or log its first one.

    An override keeps the earlier rating, marked invalid, so the trace has one
    current rating per user. A trace MLflow can't read, such as one just after
    its answer, has no rating to override, so the rating is logged as a first
    one. The read is silent because MLflow's warning carries the store's error
    text.
    """
    trace = mlflow.get_trace(trace_id, silent=True)
    ratings = trace.search_assessments(FEEDBACK_NAME, type="feedback") if trace else []
    current = next((rating for rating in ratings if rating.source == source), None)
    if current is None:
        mlflow.log_feedback(
            trace_id=trace_id,
            name=FEEDBACK_NAME,
            value=helpful,
            rationale=rationale,
            source=source,
        )
    else:
        mlflow.override_feedback(
            trace_id=trace_id,
            assessment_id=current.assessment_id,
            value=helpful,
            rationale=rationale,
            source=source,
        )
