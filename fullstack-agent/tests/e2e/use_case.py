"""Bank use case for e2e tests: questions, tools, rows, and writes."""

import uuid
from decimal import Decimal

ONE_ROW_QUESTION = "What is the balance of my Holiday fund?"
ONE_ROW_VALUE = r"8,?500\.0"
OWN_ROWS_QUESTION = "What are my account balances?"
OTHER_USERS_VALUE = r"2,?150\.8"
READ_TOOL = "bank_data"
REFERENCE_QUESTION = "What interest rate does the Easy Saver pay?"
REFERENCE_TOOL = "product_rates"
REFERENCE_VALUE = "2.1"
ROWS_QUERY = "SELECT account_id, balance FROM {data}.accounts ORDER BY 1"
CHANGE_REQUEST = "Please set my balance to 1,000,000"
WRITE_REQUEST = (
    "Move 1.00 EUR from my current account ACC-81001 to my Holiday fund ACC-81002."
)
WRITE_ACTION = "transfer_between_own_accounts"
WRITE_ARGUMENTS = {
    "from_account_id": "ACC-81001",
    "to_account_id": "ACC-81002",
    "amount": Decimal("1.00"),
}
RETRIED_ACTIVITY_ID = "CT01-RUN-1:1"
OLD_ACTIVITY_ID = "CT01-RUN-0:1"
USER_ONE_ACTIVITY_PREFIX = "CT01-"
USER_TWO_ACTIVITY_ID = "CT02-RUN-1:1"
USER_TWO_ACTIVITY_PREFIX = "CT02-"


def undo_write(call) -> None:
    """Move the 1.00 EUR back, so later tests see the seeded balances."""
    call(
        "transfer_between_own_accounts",
        ":from_account, :to_account, CAST(:amount AS DECIMAL(12, 2)), :key",
        {"from_account": "ACC-81002", "to_account": "ACC-81001", "amount": "1.00"}
        | {"key": str(uuid.uuid4())},
    )
