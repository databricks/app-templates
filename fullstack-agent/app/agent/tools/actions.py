"""Write tools that propose changes for customer confirmation."""

from decimal import Decimal
from typing import Annotated, Literal

from agents import RunContextWrapper
from pydantic import Field

from agent.approvals import Action, proposal_tool, propose
from agent.context import RequestContext
from agent.procedures import Procedure
from agent.tools import Step
from agent.tools.user_data import payment_details

ReasonCode = Literal["UNRECOGNISED", "DUPLICATE", "WRONG_AMOUNT", "GOODS_NOT_RECEIVED"]
AccountId = Annotated[str, Field(pattern=r"^ACC-[0-9]{4,6}$")]
TransactionId = Annotated[str, Field(pattern=r"^[A-Z]{2,3}-[A-Z0-9-]{1,40}$")]
Amount = Annotated[Decimal, Field(max_digits=12, decimal_places=2)]

ACTIONS = {
    "file_dispute": Action(
        Procedure(
            "file_dispute",
            ":transaction_id, :reason_code, :note, :idempotency_key",
        ),
        "Dispute filed",
    ),
    "transfer_between_own_accounts": Action(
        Procedure(
            "transfer_between_own_accounts",
            ":from_account_id, :to_account_id, CAST(:amount AS DECIMAL(12, 2)), "
            ":idempotency_key",
        ),
        "Transfer completed",
    ),
    "update_contact_details": Action(
        Procedure(
            "update_contact_details",
            ":phone, :address_line1, :city, :postcode, :idempotency_key",
        ),
        "Contact details updated",
    ),
}


@proposal_tool
async def propose_file_dispute(
    ctx: RunContextWrapper[RequestContext],
    step: Step,
    transaction_id: TransactionId,
    reason_code: ReasonCode,
    note: Annotated[str, Field(max_length=500)],
) -> str:
    """Prepare a dispute on one of the customer's payments, for them to confirm.

    The bank files a dispute only when the transaction is the customer's, its
    direction is DEBIT, it was booked in the last 120 days, and it has no
    dispute yet. Nothing is filed until the customer confirms.

    The card shows the customer the payment's merchant, amount and booking
    date from the bank's data.

    Args:
        transaction_id: The transaction_id from bank_data, for example
            TX-1003-899.
        reason_code: UNRECOGNISED: they don't recognise the payment. DUPLICATE:
            they were charged twice. WRONG_AMOUNT: the amount is wrong.
            GOODS_NOT_RECEIVED: they didn't receive what they paid for.
        note: The customer's own words, at most 500 characters. Empty if none.
    """
    return await propose(
        ctx.context,
        "file_dispute",
        {
            "transaction_id": transaction_id,
            "reason_code": reason_code,
            "note": note,
        },
        await payment_details(ctx.context, transaction_id),
    )


@proposal_tool
async def propose_transfer(
    ctx: RunContextWrapper[RequestContext],
    step: Step,
    from_account_id: AccountId,
    to_account_id: AccountId,
    amount: Amount,
) -> str:
    """Prepare a move of money between the customer's own accounts, for them to confirm.

    The bank moves money only between two different open accounts of the
    customer, in the same currency. The amount is above 0, at most EUR 5,000,
    and no more than the from account's balance plus its credit limit. Nothing
    moves until the customer confirms.

    Args:
        from_account_id: The account to take the money from, for example ACC-2001.
        to_account_id: The account to put the money in, for example ACC-2002.
        amount: The amount in EUR, with at most 2 decimals, for example 200.00.
    """
    return await propose(
        ctx.context,
        "transfer_between_own_accounts",
        {
            "from_account_id": from_account_id,
            "to_account_id": to_account_id,
            "amount": str(amount),
        },
    )


@proposal_tool
async def propose_contact_update(
    ctx: RunContextWrapper[RequestContext],
    step: Step,
    phone: Annotated[str, Field(max_length=20)],
    address_line1: Annotated[str, Field(max_length=100)],
    city: Annotated[str, Field(max_length=100)],
    postcode: Annotated[str, Field(max_length=20)],
) -> str:
    """Prepare new contact details for the customer, for them to confirm.

    Send all four fields, and keep the current value of any field the customer
    doesn't change. The bank saves them only when the phone number is a plus
    sign and 8 to 15 digits, with no spaces and a first digit that isn't 0,
    and the address, city and postcode aren't blank. The address and city are
    at most 100 characters, and the postcode at most 20. Nothing changes until
    the customer confirms.

    Args:
        phone: The phone number, for example +31612345678.
        address_line1: The street address.
        city: The city.
        postcode: The postcode.
    """
    return await propose(
        ctx.context,
        "update_contact_details",
        {
            "phone": phone,
            "address_line1": address_line1,
            "city": city,
            "postcode": postcode,
        },
    )
