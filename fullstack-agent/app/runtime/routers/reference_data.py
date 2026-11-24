"""The bank's endpoints behind the Rates page, read as the app."""

from fastapi import APIRouter

from agent.tools.reference_data import read_products
from runtime.auth import SignedIn

router = APIRouter()


@router.get("/products")
def products(caller: SignedIn) -> list[dict[str, str | None]]:
    return read_products(caller.client_for("app"))
