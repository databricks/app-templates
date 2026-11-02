import json
import subprocess

import pytest

pytestmark = pytest.mark.user_scope


@pytest.fixture(scope="module")
def service_name(config, schemas) -> str:
    return f"{config['catalog']}.{schemas.ops}.sonnet_llm"


def test_model_service_routes_to_sonnet_with_token_limits(service_name):
    result = subprocess.run(
        [
            "databricks",
            "ai-gateway",
            "get-model-service",
            f"model-services/{service_name}",
        ]
        + ["-o", "json"],
        check=True,
        capture_output=True,
        text=True,
    )
    routing = json.loads(result.stdout)["config"]["routing"]

    primary = [d["pay_per_token_config"]["model"] for d in routing["destinations"]]
    assert primary == ["models/system.ai.databricks-claude-sonnet-5-5"]
    assert "fallback" not in routing


def test_a_user_can_call_the_model_service(workspace, service_name):
    response = workspace.api_client.do(
        "POST",
        "/ai-gateway/mlflow/v1/chat/completions",
        body={
            "model": service_name,
            "messages": [{"role": "user", "content": "Reply with the word ready."}],
            "max_tokens": 16,
        },
    )

    assert response["choices"][0]["message"]["content"]
