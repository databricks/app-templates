"""Playwright happy-path test for the Streamlit Todo List App.

Verifies the Streamlit app shell mounts and the app's real primary heading
renders. ``app.py`` calls ``st.title("Todo List App")`` (see
``streamlit-database-app/app.py``), which Streamlit renders as an
accessible heading inside the ``[data-testid='stApp']`` shell -- this is
the actual content of the deployed app, not a placeholder selector.

Reads ``PLAYWRIGHT_BASE_URL`` (required) and ``PLAYWRIGHT_STORAGE_STATE``
(optional, used for deployed/SSO-authenticated runs) from the environment,
as set by the functional-e2e orchestrator's `run_py_playwright` runner.
"""
import os

from playwright.sync_api import sync_playwright, expect


def test_app_renders_core_ui():
    base = os.environ["PLAYWRIGHT_BASE_URL"]
    state = os.environ.get("PLAYWRIGHT_STORAGE_STATE")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(storage_state=state) if state else browser.new_context()
        page = ctx.new_page()
        page.goto(base, wait_until="networkidle")

        # happy-path: the Streamlit app shell mounts...
        page.wait_for_selector("[data-testid='stApp']", timeout=30000)

        # ...and the app's actual primary heading ("Todo List App", from
        # st.title() in app.py) is visible -- not a guessed selector.
        heading = page.get_by_role("heading", name="Todo List App")
        expect(heading).to_be_visible(timeout=30000)

        browser.close()
