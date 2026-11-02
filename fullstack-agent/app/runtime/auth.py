"""Signed-in caller from X-Forwarded-Email header; shared app identity client."""

from collections.abc import Iterator
from dataclasses import dataclass
from functools import cache
from typing import Annotated

from databricks.sdk import WorkspaceClient
from databricks_agentkit.runtime.auth import AuthError, RequestAuthContext
from databricks_agentkit.runtime.workspace import workspace_client
from fastapi import Depends, Request


@cache
def app_client() -> WorkspaceClient:
    """The app identity's cached, shared client; does not affect user identity."""
    return workspace_client()


@dataclass(frozen=True)
class Caller:
    """The signed-in user of one request, with the clients that act for it."""

    email: str
    auth: RequestAuthContext

    def client_for(self, mode: str) -> WorkspaceClient:
        return app_client() if mode == "app" else self.auth.client_for(mode)

    def store_session_id(self, conversation_id: str) -> str:
        """The store's ID for a conversation: the namespaced ID the runtime uses."""
        return self.auth.namespace("session", conversation_id)


def signed_in_caller(request: Request) -> Iterator[Caller]:
    """Resolve signed-in user and token; take email from X-Forwarded-Email header."""
    auth = RequestAuthContext.from_headers(request.headers)
    try:
        email = request.headers.get("x-forwarded-email", "").strip()
        if not email:
            raise AuthError(
                "MCP_USER_IDENTITY_MISSING", "Missing trusted request-user email"
            )
        yield Caller(email=email, auth=auth)
    finally:
        auth.close()


SignedIn = Annotated[Caller, Depends(signed_in_caller)]
