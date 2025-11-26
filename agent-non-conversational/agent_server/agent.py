"""Non-conversational agent for document analysis using MLflow model serving."""

import json
import logging
import os

import mlflow
from databricks.sdk import WorkspaceClient
from mlflow.entities import SpanType
from mlflow.genai.agent_server import invoke
from mlflow.pyfunc import PythonModel
from pydantic import BaseModel, Field


class Question(BaseModel):
    """Represents a question in the input."""

    text: str = Field(..., description="Yes/no question about document content")


class AgentInput(BaseModel):
    """Input model for the document analyser agent."""

    document_text: str = Field(..., description="The document text to analyze")
    questions: list[Question] = Field(..., description="List of yes/no questions")


class Answer(BaseModel):
    """Represents a structured response from the LLM."""

    answer: str = Field(..., description="Yes or No answer")
    chain_of_thought: str = Field(..., description="Step-by-step reasoning for the answer")


class AnalysisResult(BaseModel):
    """Represents an analysis result in the output."""

    question_text: str = Field(..., description="Original question text")
    answer: str = Field(..., description="Yes or No answer")
    chain_of_thought: str = Field(..., description="Step-by-step reasoning for the answer")
    span_id: str | None = Field(
        None,
        description="MLflow span ID for this specific answer (None during offline evaluation)",
    )


class AgentOutput(BaseModel):
    """Output model for the document analyser agent."""

    results: list[AnalysisResult] = Field(..., description="List of analysis results")
    trace_id: str | None = Field(
        None,
        description="MLflow trace ID for user feedback collection (None during offline evaluation)",
    )


class DocumentAnalyser(PythonModel):
    """Non-conversational agent for document analysis using MLflow model serving.

    Example use case:
        The agent processes structured questions about financial document
        content and provides yes/no answers with reasoning. Users provide both the document
        text and questions directly in the input, eliminating the need for vector search infrastructure
        in this simplified example. This demonstrates how non-conversational agents can handle specific,
        well-defined tasks without conversation context, while maintaining full traceability through MLflow 3.

    Real-world extensions:
        This simplified example can be easily extended for production use cases by integrating additional
        tools and capabilities. Examples include vector search for document retrieval, MCP (Model Context Protocol)
        tools for external integrations, or other Databricks agents like Genie for structured data access.
        The core MLflow tracing and monitoring patterns demonstrated here remain consistent regardless of
        the underlying system complexity.
    """

    def __init__(self) -> None:
        """Initialize the document analyser.

        Sets up model properties and prepares the model for serving.
        """
        self.model_name = "document_analyser_v1"
        self.logger = logging.getLogger(__name__)

        # set up workspace client and openai client
        self.w = WorkspaceClient()
        self.openai_client = self.w.serving_endpoints.get_open_ai_client()

    @mlflow.trace(name="answer_question", span_type=SpanType.LLM)
    def answer_question(self, question_text: str, document_text: str) -> tuple[object, str | None]:
        """Answer a question using LLM with structured response format.

        Uses the OpenAI-compatible client to call a language model with a structured
        JSON response format. The LLM analyzes the provided document text and returns
        a yes/no answer with reasoning.

        Args:
            question_text (str): The yes/no question to answer about the document
            document_text (str): The document text to analyze

        Returns:
            tuple: (openai.ChatCompletion, str|None) - LLM response and span_id
        """
        # Create a chat completion request with structured response for questions

        question_prompt = f"""
        You are a document analysis expert. Answer the following yes/no question based on the provided document.

        Question: "{question_text}"

        Document:
        {document_text}

        Analyze the document and provide a structured response.
        """

        # Create a separate sub-span for the actual OpenAI API call
        llm_response = self._call_openai_completion(question_prompt)

        # Get the current span ID for this specific answer
        current_span = mlflow.get_current_active_span()
        span_id = current_span.span_id if current_span is not None else None

        return llm_response, span_id

    @mlflow.trace(name="openai_completion", span_type=SpanType.LLM)
    def _call_openai_completion(self, prompt: str):
        """Make the actual OpenAI API call with its own sub-span.

        Args:
            prompt (str): The formatted prompt to send to the LLM

        Returns:
            OpenAI ChatCompletion response
        """
        return self.openai_client.chat.completions.create(
            model=os.getenv("LLM_MODEL", "databricks-claude-3-7-sonnet"),  # Configurable LLM model
            messages=[{"role": "user", "content": prompt}],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "question_response",
                    "schema": Answer.model_json_schema(),
                },
            },
        )

    @mlflow.trace(name="document_analysis")
    def predict(self, context, model_input: list[AgentInput]) -> list[AgentOutput]:
        """Process document analysis questions with yes/no answers.

        Args:
            context: MLflow model context
            model_input: List of structured inputs containing document text and questions

        Returns:
            List of AgentOutput with yes/no answers and reasoning
        """
        self.logger.info(f"Processing {len(model_input)} classification request(s)")

        # Get the current trace ID for user feedback collection
        # Will be None during offline evaluation when no active span exists
        current_span = mlflow.get_current_active_span()
        trace_id = current_span.trace_id if current_span is not None else None

        results = []
        for input_data in model_input:
            analysis_results = []

            for question in input_data.questions:
                # Answer the question using LLM with structured response
                llm_response, answer_span_id = self.answer_question(
                    question.text, input_data.document_text
                )

                # Parse structured JSON response
                try:
                    response_data = json.loads(llm_response.choices[0].message.content)
                    answer_obj = Answer(**response_data)
                except Exception as e:
                    # Fallback to default response
                    answer_obj = Answer(
                        answer="No",
                        chain_of_thought="Unable to process the question due to parsing error.",
                    )

                analysis_results.append(
                    AnalysisResult(
                        question_text=question.text,
                        answer=answer_obj.answer,
                        chain_of_thought=answer_obj.chain_of_thought,
                        span_id=answer_span_id,
                    )
                )

            self.logger.info(f"Generated {len(analysis_results)} analysis results")

            results.append(AgentOutput(results=analysis_results, trace_id=trace_id))

        return results


model = DocumentAnalyser()


@invoke()
async def invoke(data: dict) -> dict:
    """Invoke function for the non-conversational agent."""

    # Convert input data to FinancialChecklistInput format
    input_obj = AgentInput(**data)
    result = model.predict(context=None, model_input=[input_obj])

    # Return the first result (since we only sent one input)
    return result[0].model_dump()
