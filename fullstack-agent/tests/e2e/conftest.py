import json
import subprocess
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager

import httpx
import pytest
from databricks.sdk.service.iamv2 import DirectGroupMember, WorkspaceIamV2API
from databricks.sdk.service.sql import StatementState

GROUP_CHANGE_SECONDS = 300


def cli_json(*arguments: str) -> dict:
    """Run a Databricks CLI command with the active profile and parse its JSON."""
    result = subprocess.run(
        ["databricks", *arguments, "-o", "json"],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout) if result.stdout.strip() else {}


@pytest.fixture(scope="session")
def cli():
    return cli_json


def wait_until(is_done: Callable[[], bool], what: str) -> None:
    """Poll every 5 s until `is_done` holds, or fail after `GROUP_CHANGE_SECONDS`."""
    deadline = time.monotonic() + GROUP_CHANGE_SECONDS
    while not is_done():
        if time.monotonic() > deadline:
            raise AssertionError(f"{what} after {GROUP_CHANGE_SECONDS} s")
        time.sleep(5)


@pytest.fixture(scope="session")
def leave_group():
    """Take a principal out of a group for a block. Any failure, even during the
    removal, adds it back if the group no longer lists it."""

    @contextmanager
    def outside(
        iam: WorkspaceIamV2API,
        group_id: str,
        principal_id: int,
        can_read: Callable[[], bool],
    ) -> Iterator[None]:
        try:
            iam.delete_direct_group_member_proxy(group_id, principal_id)
            wait_until(lambda: not can_read(), "Reads still work outside the group")
            yield
        finally:
            members = iam.list_direct_group_members_proxy(group_id)
            if principal_id not in {member.principal_id for member in members}:
                iam.create_direct_group_member_proxy(
                    group_id, DirectGroupMember(principal_id=principal_id)
                )
            wait_until(can_read, "Reads are still refused after rejoining the group")

    return outside


@pytest.fixture(scope="session")
def outside_app_users_group(
    workspace, config, test_user_one_client, schemas, leave_group
):
    """Temporarily remove test user one from app users group for testing."""

    def can_read() -> bool:
        response = test_user_one_client.statement_execution.execute_statement(
            statement=f"SELECT 1 FROM {schemas.ops}.action_audit LIMIT 1",
            warehouse_id=config["warehouse_id"],
            catalog=config["catalog"],
            wait_timeout="50s",
        )
        if response.status.state == StatementState.SUCCEEDED:
            return True
        message = response.status.error.message if response.status.error else ""
        if "PERMISSION" in message:
            return False
        raise AssertionError(f"The read check {response.status.state.value}: {message}")

    def outside():
        iam = workspace.workspace_iam_v2
        (group,) = iam.list_groups_proxy(
            filter=f'group_name eq "{config["app_users_group"]}"'
        )
        (user,) = workspace.service_principals.list(
            filter=f'applicationId eq "{config["test_user_one_id"]}"'
        )
        return leave_group(iam, group.group_id, int(user.id), can_read)

    return outside


def sse_events(text: str) -> list[dict]:
    """Return the JSON payloads of a Server-Sent Events body, in order."""
    return [
        json.loads(line[5:])
        for line in text.splitlines()
        if line.startswith("data:") and line[5:].strip()
    ]


def parse_body(response: httpx.Response) -> dict:
    if "text/event-stream" in response.headers.get("content-type", ""):
        return sse_events(response.text)[-1]
    return response.json()


class AgentClient:
    """One conversation with the deployed agent app, as one bearer token."""

    def __init__(self, url: str, token: str):
        self._url = f"{url}/api/invocations"
        self._token = token
        self.session_id = str(uuid.uuid4())

    def invoke(self, agent_input: dict) -> list[dict]:
        """Send one invocation and return its streamed events."""
        response = httpx.post(
            self._url,
            headers={
                "Authorization": f"Bearer {self._token}",
                "Accept": "text/event-stream",
                "X-Routing-Key": self.session_id,
            },
            json={
                "id": str(uuid.uuid4()),
                "session_id": self.session_id,
                "input": agent_input,
                "stream": True,
            },
            timeout=180,
        )
        response.raise_for_status()
        return sse_events(response.text)

    def ask(self, text: str) -> list[dict]:
        return self.invoke({"messages": [{"role": "user", "content": text}]})

    def confirm(self, proposal_id: str, decision: str = "approve") -> list[dict]:
        return self.invoke(
            {"confirm": {"proposal_id": proposal_id, "decision": decision}}
        )


@pytest.fixture(scope="session")
def agent_app(config) -> dict:
    return cli_json("apps", "get", config["agent_app_name"])


@pytest.fixture(scope="session")
def api(agent_app, test_user_one_token) -> httpx.Client:
    return httpx.Client(
        base_url=f"{agent_app['url']}/api",
        headers={"Authorization": f"Bearer {test_user_one_token}"},
        timeout=90,
    )


@pytest.fixture
def agent(agent_app, test_user_one_token) -> AgentClient:
    return AgentClient(agent_app["url"], test_user_one_token)


@pytest.fixture
def other_agent(agent_app, test_user_one_token) -> AgentClient:
    """A second conversation for the same user (test user one)."""
    return AgentClient(agent_app["url"], test_user_one_token)


@pytest.fixture
def user_two_agent(agent_app, test_user_two_token) -> AgentClient:
    """An agent client for a different user (test user two)."""
    return AgentClient(agent_app["url"], test_user_two_token)


@pytest.fixture(scope="session")
def other_api(agent_app, test_user_two_token) -> httpx.Client:
    """An API client for a different user (test user two)."""
    return httpx.Client(
        base_url=f"{agent_app['url']}/api",
        headers={"Authorization": f"Bearer {test_user_two_token}"},
        timeout=90,
    )
