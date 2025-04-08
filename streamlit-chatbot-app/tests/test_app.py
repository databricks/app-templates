import os
from unittest.mock import patch
import streamlit.testing.v1 as st_test

@patch("model_serving_utils.query_endpoint")
def test_app_renders_and_responds(mock_query):
    mock_query.return_value = {"role": "assistant", "content": "Mock response"}
    os.environ["SERVING_ENDPOINT"] = "dummy-endpoint"
    app = st_test.AppTest.from_file("app.py")
    app.run()
    app.chat_input[0].set_value("Hi there!")
    app.run()
    assert "Mock response" in set([md.value for md in app.markdown])
