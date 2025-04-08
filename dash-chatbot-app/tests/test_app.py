import pytest
from unittest.mock import patch
import os
os.environ['SERVING_ENDPOINT'] = "dummy-endpoint"
serving_endpoint = os.getenv('SERVING_ENDPOINT')
assert serving_endpoint, 'SERVING_ENDPOINT must be set in app.yaml.'

from app import app as dash_app


@pytest.fixture
def app():
    return dash_app


def test_chat_submission_mocks_endpoint(dash_duo):
    # Patch the endpoint query to simulate an assistant reply
    with patch("model_serving_utils.query_endpoint", return_value="Mocked assistant response."):
        dash_duo.start_server(app)


        input_box = dash_duo.find_element("#user-input")
        send_button = dash_duo.find_element("#send-button")

        input_box.send_keys("Hi there")
        send_button.click()

        dash_duo.wait_for_text_to_equal("#user-input", "")  # Ensure it cleared the input

        # Confirm the mocked assistant response shows up
        assistant_msgs = dash_duo.find_elements(".assistant-message")
        assert any("Mocked assistant response." in msg.text for msg in assistant_msgs)


def test_clear_button(dash_duo):
    dash_duo.start_server(app)

    input_box = dash_duo.find_element("#user-input")
    send_btn = dash_duo.find_element("#send-button")
    clear_btn = dash_duo.find_element("#clear-button")

    input_box.send_keys("Hello!")
    send_btn.click()

    clear_btn.click()

    dash_duo.wait_for_text_to_equal("#chat-history", "")  # chat should be cleared
