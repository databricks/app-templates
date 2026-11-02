"""The bank's endpoints behind the Accounts page, read as the customer."""

from fastapi import APIRouter

from agent.statement_execution import run_query
from agent.tools.user_data import query
from runtime.auth import SignedIn

router = APIRouter()


@router.get("/me/accounts")
def my_accounts(caller: SignedIn) -> list[dict[str, str | None]]:
    return run_query(caller.client_for("user"), query("accounts"))
