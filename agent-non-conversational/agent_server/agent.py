"""Non-conversational agent for document analysis using MLflow model serving."""

import json
import os
from time import perf_counter_ns
from uuid import uuid4

from databricks.sdk import WorkspaceClient
from mlflow.entities import SpanType
from mlflow.genai.agent_server import invoke
from pydantic import BaseModel, Field

from agent_server.tracing import (
    UsageAccumulator,
    completion_usage,
    configure_mlflow_tracing,
    document_identity,
    elapsed_ms,
    safe_error_message,
    set_request_trace_identity,
    set_span_result,
    traced_span,
)

configure_mlflow_tracing()
w = WorkspaceClient()
openai_client = w.serving_endpoints.get_open_ai_client()


class AgentInput(BaseModel):
    document_text: str = Field(..., description="The document text to analyze")
    questions: list[str] = Field(..., description="List of yes/no questions")


class AnalysisResult(BaseModel):
    question_text: str = Field(..., description="Original question text")
    answer: str = Field(..., description="Yes or No answer")
    reasoning: str = Field(..., description="Step-by-step reasoning for the answer")


class AgentOutput(BaseModel):
    results: list[AnalysisResult] = Field(..., description="List of analysis results")


def construct_analysis_prompt(question: str, document_text: str) -> str:
    return f"""You are a document analysis expert. Answer the following yes/no question based on the provided document.

Question: "{question}"

Document:
{document_text}

Return ONLY a JSON object (no markdown, no code fences, no additional text) with these two fields:
- answer: "Yes" or "No"
- reasoning: Brief explanation of your reasoning

Example JSON output:
{{
    "answer": "Yes",
    "reasoning": "The document contains a balance sheet."
}}
"""


@invoke()
async def invoke_handler(data: dict) -> dict:
    """Process document analysis questions and generate yes/no answers.

    Args:
        data: Dictionary containing document_text and list of questions

    Returns:
        Dictionary with analysis results for each question
    """
    root_started_ns = perf_counter_ns()
    with traced_span("document.analysis", SpanType.AGENT, data) as root_span:
        session_id = str(data.get("session_id") or uuid4())
        user_id = str(data.get("user_id") or "anonymous")
        request_id = str(data.get("request_id") or uuid4())
        set_request_trace_identity(
            session_id=session_id,
            user_id=user_id,
            request_id=request_id,
            template_name="agent-non-conversational",
        )
        input_data = AgentInput(**data)
        doc_identity = document_identity(input_data.document_text)
        analysis_results: list[AnalysisResult] = []
        partial_outputs: list[dict] = []
        parser_errors: list[str] = []
        aggregate_usage = UsageAccumulator()
        model_name = os.getenv("LLM_MODEL", "databricks-gpt-5-2")
        provider = "databricks" if model_name.startswith("databricks-") else "openai"

        for index, question in enumerate(input_data.questions):
            prompt = construct_analysis_prompt(question, input_data.document_text)
            model_started_ns = perf_counter_ns()
            with traced_span(
                "document.question.model",
                SpanType.CHAT_MODEL,
                {"question": question, "document": doc_identity},
            ) as model_span:
                try:
                    llm_response = openai_client.chat.completions.create(
                        model=model_name,
                        messages=[{"role": "user", "content": prompt}],
                    )
                except BaseException as error:
                    usage = {
                        "inputTokens": 0,
                        "outputTokens": 0,
                        "totalTokens": 0,
                        "costAvailable": False,
                    }
                    aggregate_usage.add(usage)
                    root_usage = aggregate_usage.snapshot()
                    try:
                        root_span.set_attributes(
                            {
                                "appkit.usage": root_usage,
                                "appkit.cost_available": root_usage[
                                    "costAvailable"
                                ],
                            }
                        )
                    except Exception:
                        pass
                    set_span_result(
                        model_span,
                        outputs={"error": safe_error_message(error)},
                        attributes={
                            "appkit.question_index": index,
                            "appkit.model": model_name,
                            "appkit.provider": provider,
                            "appkit.usage": usage,
                            "appkit.duration_ms": elapsed_ms(model_started_ns),
                            "appkit.error": safe_error_message(error),
                            "appkit.cost_available": False,
                        },
                        status="ERROR",
                        error=error,
                    )
                    raise
                usage = completion_usage(llm_response)
                aggregate_usage.add(usage)
                root_usage = aggregate_usage.snapshot()
                try:
                    root_span.set_attributes(
                        {
                            "appkit.usage": root_usage,
                            "appkit.cost_available": root_usage["costAvailable"],
                        }
                    )
                except Exception:
                    pass
                model_attributes = {
                    "appkit.question_index": index,
                    "appkit.model": getattr(llm_response, "model", model_name),
                    "appkit.provider": provider,
                    "appkit.usage": usage,
                    "mlflow.chat.tokenUsage": {
                        "input_tokens": usage["inputTokens"],
                        "output_tokens": usage["outputTokens"],
                        "total_tokens": usage["totalTokens"],
                    },
                    "appkit.duration_ms": elapsed_ms(model_started_ns),
                    "appkit.finish_reason": getattr(
                        llm_response.choices[0], "finish_reason", None
                    ),
                    "appkit.error": None,
                    "appkit.cost_available": usage["costAvailable"],
                }
                if usage["costAvailable"]:
                    model_attributes["appkit.cost_usd"] = usage["costUsd"]
                    model_attributes["mlflow.llm.cost"] = {
                        "total_cost": usage["costUsd"]
                    }
                set_span_result(
                    model_span,
                    outputs=llm_response,
                    attributes=model_attributes,
                    status="OK",
                )

            response_text = llm_response.choices[0].message.content
            parser_started_ns = perf_counter_ns()
            with traced_span(
                "document.question.parse",
                SpanType.PARSER,
                {"question": question, "response": response_text},
            ) as parser_span:
                try:
                    response_data: dict = json.loads(response_text)
                    answer = response_data.get("answer", "No")
                    reasoning = response_data.get("reasoning", "")
                except Exception as error:
                    safe_error = safe_error_message(error)
                    if not parser_errors:
                        partial_outputs = [item.model_dump() for item in analysis_results]
                    parser_errors.append(safe_error)
                    answer = "No"
                    reasoning = (
                        "Unable to process the question due to parsing error: "
                        f"{error}"
                    )
                    set_span_result(
                        parser_span,
                        outputs={
                            "error": safe_error,
                            "partialOutputs": partial_outputs,
                        },
                        attributes={
                            "appkit.question_index": index,
                            "appkit.duration_ms": elapsed_ms(parser_started_ns),
                            "appkit.error": safe_error,
                        },
                        status="ERROR",
                        error=error,
                    )
                else:
                    set_span_result(
                        parser_span,
                        outputs=response_data,
                        attributes={
                            "appkit.question_index": index,
                            "appkit.duration_ms": elapsed_ms(parser_started_ns),
                            "appkit.error": None,
                        },
                        status="OK",
                    )

            analysis_results.append(
                AnalysisResult(
                    question_text=question,
                    answer=answer,
                    reasoning=reasoning,
                )
            )

        output = AgentOutput(results=analysis_results).model_dump()
        root_outputs = {"results": output["results"], "partialOutputs": partial_outputs}
        aggregate_snapshot = aggregate_usage.snapshot()
        root_attributes = {
            "appkit.usage": aggregate_snapshot,
            "appkit.duration_ms": elapsed_ms(root_started_ns),
            "appkit.error": parser_errors[0] if parser_errors else None,
            "appkit.cost_available": aggregate_snapshot["costAvailable"],
        }
        if aggregate_snapshot["costAvailable"]:
            root_attributes["appkit.cost_usd"] = aggregate_snapshot["costUsd"]
        if parser_errors:
            set_span_result(
                root_span,
                outputs=root_outputs,
                attributes=root_attributes,
                status="ERROR",
                error=RuntimeError(parser_errors[0]),
            )
        else:
            set_span_result(
                root_span,
                outputs=root_outputs,
                attributes=root_attributes,
                status="OK",
            )
        return output
