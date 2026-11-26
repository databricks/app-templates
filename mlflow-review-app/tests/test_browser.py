"""The start page and the /setup journeys in a real browser, against a fake gateway.

Needs a Chromium: `playwright install chromium`, or set CHROME to a Chromium binary. Screenshots go
to tests/*.png (or $SHOTS), for PR descriptions.
"""

import os
import socket
import threading
import time

import pytest
import uvicorn
from conftest import ALICE, ALL_GOOD, ANN, SP, TABLE_PREFIX, FakeGateway

from app import create_app
from review_queue import ReviewQueue

sync_api = pytest.importorskip("playwright.sync_api")
SHOTS = os.environ.get("SHOTS", "tests")
MISSING_MODIFY = {**ALL_GOOD, ANN: ["SELECT"]}


@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as p:
        try:
            b = p.chromium.launch(executable_path=os.environ.get("CHROME") or None)
        except Exception as e:  # no browser installed
            pytest.skip(f"No Chromium: {e}")
        yield b
        b.close()


@pytest.fixture
def serve():
    servers = []

    def _serve(fake: FakeGateway, pinned: str | None = TABLE_PREFIX) -> str:
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        server = uvicorn.Server(
            uvicorn.Config(
                create_app(ReviewQueue(gateway=fake, trace_destination=pinned)), port=port, log_level="warning"
            )
        )
        threading.Thread(target=server.run, daemon=True).start()
        while not server.started:
            time.sleep(0.02)
        servers.append(server)
        return f"http://127.0.0.1:{port}"

    yield _serve
    for s in servers:
        s.should_exit = True


def open_as(browser, url, scheme="light"):
    """The headers the Apps proxy adds after sign-in, with a token since the app has the sql scope."""
    page = browser.new_page(viewport={"width": 1200, "height": 800}, color_scheme=scheme)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.set_extra_http_headers({"x-forwarded-email": ALICE, "x-forwarded-access-token": "tok-alice"})
    page.goto(url)
    return page, errors


def test_start_page_links_to_setup_without_checking_it(browser, serve):
    page, errors = open_as(browser, serve(FakeGateway(privileges=dict(MISSING_MODIFY))) + "/")
    requests = []
    page.on("request", lambda r: requests.append(r.url))
    page.reload(wait_until="networkidle")
    page.get_by_text(f"Signed in as {ALICE}").wait_for()
    assert page.get_by_role("link", name="Open setup →").get_attribute("href") == "/setup"
    assert not any("/api/review-queue/setup" in u for u in requests)  # no setup checks on each visit
    page.screenshot(path=f"{SHOTS}/start-1.png", full_page=True)
    assert errors == []


@pytest.mark.parametrize("scheme", ["light", "dark"])
def test_setup_one_table_missing_grant_ready(browser, serve, scheme):
    fake = FakeGateway(privileges=dict(MISSING_MODIFY), owners={"cat": ALICE})
    page, errors = open_as(browser, serve(fake) + "/setup", scheme)
    page.get_by_text("Give the app access to the trace tables").wait_for()
    assert page.locator("#sp").get_attribute("title") == SP
    assert page.locator("#grant-warn").is_hidden()  # Alice owns the catalog
    assert "4 of 4 ready" in page.locator("#step-resources").inner_text()
    assert "4 of 5 ready" in page.locator("#step-access").inner_text()
    assert page.locator("#rows .row").count() == 1  # only the missing check is listed
    page.screenshot(path=f"{SHOTS}/setup-1-missing-{scheme}.png", full_page=True)
    page.get_by_role("button", name="Grant access").click()
    # The dialog names every table and privilege before anything runs.
    dialog = page.locator("#confirm")
    dialog.wait_for()
    assert dialog.locator("li").all_inner_texts() == [f"MODIFY, SELECT on {ANN}"]
    assert TABLE_PREFIX in page.locator("#confirm-dest").inner_text()
    page.screenshot(path=f"{SHOTS}/setup-5-confirm-{scheme}.png")
    page.locator("#confirm-grant").click()
    page.get_by_text("Everything the app needs is in place").wait_for()
    assert "5 of 5 ready" in page.locator("#step-access").inner_text()
    assert page.locator("#grant").is_hidden()
    assert "9 checks passed" in page.locator("#passed-text").inner_text()
    page.screenshot(path=f"{SHOTS}/setup-2-ready-{scheme}.png", full_page=True)
    assert errors == []


def test_setup_warns_before_grant_when_someone_else_owns_the_tables(browser, serve):
    page, _ = open_as(browser, serve(FakeGateway(privileges=dict(MISSING_MODIFY))) + "/setup")
    page.get_by_text("You can't grant this table.").wait_for()
    assert "someone@else.com" in page.locator("#grant-warn").inner_text()
    page.locator("#action").screenshot(path=f"{SHOTS}/setup-3-cannot-grant.png")


def test_setup_shows_each_failed_grant_and_lets_you_try_again(browser, serve):
    fake = FakeGateway(privileges=dict(MISSING_MODIFY), owners={"cat": ALICE}, deny_statements=["GRANT"])
    page, errors = open_as(browser, serve(fake) + "/setup")
    page.get_by_role("button", name="Grant access").click()
    page.locator("#confirm-grant").click()
    page.get_by_text("You can't grant all of these tables").wait_for()
    assert "PERMISSION_DENIED" in page.locator("#grant-result").inner_text()
    assert page.locator("#step-access").get_attribute("data-state") == "bad"
    page.get_by_role("button", name="Try again").wait_for()
    page.screenshot(path=f"{SHOTS}/setup-4-grant-failed.png", full_page=True)
    assert errors == []


def test_cancel_in_the_grant_dialog_grants_nothing(browser, serve):
    fake = FakeGateway(privileges=dict(MISSING_MODIFY), owners={"cat": ALICE})
    page, errors = open_as(browser, serve(fake) + "/setup")
    page.get_by_role("button", name="Grant access").click()
    page.locator("#confirm-cancel").click()
    assert page.locator("#confirm").is_hidden()
    assert fake.statements == []
    assert errors == []


def test_setup_asks_to_pin_the_trace_destination(browser, serve):
    page, errors = open_as(browser, serve(FakeGateway(privileges=dict(MISSING_MODIFY)), pinned=None) + "/setup")
    page.get_by_text("Set TRACE_DESTINATION in app.yaml to").wait_for()
    assert page.locator("#grant").is_hidden()
    page.locator("#action").screenshot(path=f"{SHOTS}/setup-6-pin.png")
    assert errors == []
