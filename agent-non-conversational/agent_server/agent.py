"""Non-conversational agent for document analysis using MLflow model serving."""

import json
import os

import litellm
from databricks.sdk import WorkspaceClient
from mlflow.genai.agent_server import invoke
from pydantic import BaseModel, Field

litellm.suppress_debug_info = True

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
async def invoke(data: dict) -> dict:
    """Process document analysis questions and generate yes/no answers.

    Args:
        data: Dictionary containing document_text and list of questions

    Returns:
        Dictionary with analysis results for each question
    """
    # Parse input
    input_data = AgentInput(**data)

    analysis_results = []

    # Process each question
    for question in input_data.questions:
        # Construct prompt
        prompt = construct_analysis_prompt(question, input_data.document_text)

        # Call LLM with structured output
        llm_response = openai_client.chat.completions.create(
            model=os.getenv("LLM_MODEL", "databricks-gpt-5-2"),
            messages=[{"role": "user", "content": prompt}],
        )

        # Parse response
        response_text = llm_response.choices[0].message.content
        try:
            response_data: dict = json.loads(response_text)
            answer = response_data.get("answer", "No")
            reasoning = response_data.get("reasoning", "")
        except Exception as e:
            answer = "No"
            reasoning = f"Unable to process the question due to parsing error: {e}"

        analysis_results.append(
            AnalysisResult(
                question_text=question,
                answer=answer,
                reasoning=reasoning,
            )
        )

    # Return output
    output = AgentOutput(results=analysis_results)
    return output.model_dump()
