import re
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

import pytest

DEMO_CHARGE = "TX-81003-899"
CONFLICT = "[DELTA_CONCURRENT_"


@pytest.fixture(scope="module", autouse=True)
def require_customer_one(sql, config):
    me = sql("SELECT current_user()")[0][0]
    assert me == config["test_user_one_id"], (
        f"these checks run as test user one ({config['test_user_one_id']}), "
        f"not {me}: the sql fixture is using another identity's credentials"
    )


@pytest.fixture
def transfer(call):
    """Transfer between accounts with idempotency key."""

    def run(from_account: str, to_account: str, amount: str, key: str):
        return call(
            "transfer_between_own_accounts",
            ":from_account, :to_account, CAST(:amount AS DECIMAL(12, 2)), :key",
            {"from_account": from_account, "to_account": to_account, "amount": amount}
            | {"key": key},
        )

    return run


@pytest.fixture
def balances(sql, schemas):
    def read() -> dict[str, str]:
        rows = sql(f"SELECT account_id, balance FROM {schemas.data}.accounts")
        return dict(rows)

    return read


def new_key() -> str:
    return str(uuid.uuid4())


def test_transfer_moves_money_once_and_replays_on_the_same_key(
    transfer, balances, config
):
    before = balances()
    key = new_key()

    first = transfer("ACC-81001", "ACC-81002", "1.00", key)
    after_first = balances()
    replay = transfer("ACC-81001", "ACC-81002", "1.00", key)
    after_replay = balances()
    transfer("ACC-81002", "ACC-81001", "1.00", new_key())

    assert first.status == "OK"
    assert first.reference.startswith("TRF-")
    assert first.acted_as == config["test_user_one_id"]
    assert float(after_first["ACC-81001"]) == pytest.approx(
        float(before["ACC-81001"]) - 1
    )
    assert float(after_first["ACC-81002"]) == pytest.approx(
        float(before["ACC-81002"]) + 1
    )
    assert (replay.status, replay.reference) == ("OK_REPLAYED", first.reference)
    assert after_replay == after_first


def test_transfer_to_another_customers_account_is_rejected_and_audited(
    transfer, balances, sql, config, schemas
):
    before = balances()
    key = new_key()

    result = transfer("ACC-81001", "ACC-82001", "1.00", key)

    assert result.status == "REJECTED"
    assert (
        result.message == "Both accounts must be different open accounts in your name."
    )
    assert balances() == before
    audit = sql(
        f"SELECT actor, outcome, reason FROM {schemas.ops}.action_audit "
        "WHERE idempotency_key = :key",
        {"key": key},
    )
    assert audit == [[config["test_user_one_id"], "REJECTED", result.message]]


def test_transfer_from_another_customers_account_is_rejected(transfer, balances):
    before = balances()

    result = transfer("ACC-82001", "ACC-81001", "50.00", new_key())

    assert result.status == "REJECTED"
    assert (
        result.message == "Both accounts must be different open accounts in your name."
    )
    assert balances() == before


@pytest.mark.parametrize(
    ("from_account", "amount", "expected"),
    [
        ("ACC-81001", "0.00", "The amount must be above 0."),
        ("ACC-81002", "5000.01", "The maximum per transfer is €5,000."),
        ("ACC-81001", "4000.00", "The amount exceeds the available balance."),
    ],
)
def test_transfer_amount_rules(transfer, balances, from_account, amount, expected):
    before = balances()
    to_account = "ACC-81002" if from_account == "ACC-81001" else "ACC-81001"

    result = transfer(from_account, to_account, amount, new_key())

    assert (result.status, result.message) == ("REJECTED", expected)
    assert balances() == before


@pytest.fixture
def dispute(call):
    def run(transaction_id: str, reason: str, key: str):
        return call(
            "file_dispute",
            ":transaction_id, :reason, :note, :key",
            {"transaction_id": transaction_id, "reason": reason}
            | {"note": "Raised by the automated tests.", "key": key},
        )

    return run


def undisputed_transaction(sql, schemas, direction: str) -> str:
    rows = sql(
        f"SELECT t.transaction_id FROM {schemas.data}.transactions t "
        f"LEFT ANTI JOIN {schemas.data}.disputes d USING (transaction_id) "
        "WHERE t.direction = :direction AND t.transaction_id <> :demo_charge "
        "AND t.booked_at > current_timestamp() - INTERVAL 100 DAYS "
        "ORDER BY t.booked_at DESC LIMIT 1",
        {"direction": direction, "demo_charge": DEMO_CHARGE},
    )
    if not rows:
        pytest.skip(f"no undisputed {direction} transaction left; run reset_data")
    return rows[0][0]


def test_dispute_is_filed_once_per_transaction(dispute, sql, schemas):
    transaction_id = undisputed_transaction(sql, schemas, "DEBIT")
    key = new_key()

    filed = dispute(transaction_id, "UNRECOGNISED", key)
    replay = dispute(transaction_id, "UNRECOGNISED", key)
    duplicate = dispute(transaction_id, "UNRECOGNISED", new_key())

    assert filed.status == "OK"
    assert filed.reference.startswith("DSP-")
    assert (replay.status, replay.reference) == ("OK_REPLAYED", filed.reference)
    assert (duplicate.status, duplicate.message) == (
        "REJECTED",
        "This payment has already been disputed.",
    )
    stored = sql(
        f"SELECT status, reason_code FROM {schemas.data}.disputes "
        "WHERE dispute_id = :reference",
        {"reference": filed.reference},
    )
    assert stored == [["OPEN", "UNRECOGNISED"]]


def test_dispute_on_a_credit_is_rejected(dispute, sql, schemas):
    result = dispute(
        undisputed_transaction(sql, schemas, "CREDIT"), "UNRECOGNISED", new_key()
    )

    assert (result.status, result.message) == (
        "REJECTED",
        "Only outgoing payments can be disputed.",
    )


def test_dispute_on_another_customers_transaction_is_rejected(dispute):
    result = dispute("TX-82001-001", "UNRECOGNISED", new_key())

    assert (result.status, result.message) == (
        "REJECTED",
        "We can't find this payment in your accounts.",
    )


def test_an_unknown_id_is_refused_like_another_customers_id(transfer, dispute):
    others = [
        transfer("ACC-81001", "ACC-82001", "1.00", new_key()),
        dispute("TX-82001-001", "UNRECOGNISED", new_key()),
    ]
    unknown = [
        transfer("ACC-81001", "ACC-99999", "1.00", new_key()),
        dispute("TX-0000-000", "UNRECOGNISED", new_key()),
    ]

    assert [result.message for result in unknown] == [
        result.message for result in others
    ]


def test_dispute_with_unknown_reason_is_rejected(dispute, sql, schemas):
    result = dispute(undisputed_transaction(sql, schemas, "DEBIT"), "BORED", new_key())

    assert result.status == "REJECTED"
    assert result.message == "Choose a valid reason for this dispute."


@pytest.fixture
def update_contact(call):
    def run(phone: str, address: str, city: str, postcode: str, key: str):
        return call(
            "update_contact_details",
            ":phone, :address, :city, :postcode, :key",
            {"phone": phone, "address": address, "city": city, "postcode": postcode}
            | {"key": key},
        )

    return run


def test_contact_details_update_and_phone_validation(update_contact, sql, schemas):
    query = f"SELECT phone, address_line1, city, postcode FROM {schemas.data}.customers"
    original = sql(query)[0]

    updated = update_contact(
        "+31699999999", "Damrak 1", "Amsterdam", "1012 LG", new_key()
    )
    stored = sql(query)[0]
    invalid = update_contact(
        "0612345678", "Damrak 1", "Amsterdam", "1012 LG", new_key()
    )
    after_invalid = sql(query)[0]
    update_contact(*original, new_key())

    assert updated.status == "OK"
    assert updated.reference.startswith("CON-")
    assert stored == ["+31699999999", "Damrak 1", "Amsterdam", "1012 LG"]
    assert invalid.status == "REJECTED"
    assert invalid.message.startswith(
        "The phone number must be in international format"
    )
    assert after_invalid == stored
    assert sql(query)[0] == original


def test_transfer_with_null_sending_balance_is_rejected(transfer):
    result = transfer("ACC-81098", "ACC-81001", "1.00", new_key())

    assert result.status == "REJECTED"
    assert "balance" in result.message.lower()


def test_transfer_with_null_receiving_balance_is_rejected(transfer):
    result = transfer("ACC-81001", "ACC-81098", "1.00", new_key())

    assert result.status == "REJECTED"
    assert "balance" in result.message.lower()


def test_dispute_with_null_booked_at_is_rejected(dispute):
    result = dispute("TX-81001-998", "UNRECOGNISED", new_key())

    assert result.status == "REJECTED"
    assert (
        result.message
        == "This payment has no booking date yet, so it can't be disputed."
    )


def test_audit_rows_show_only_the_caller(sql, config, schemas):
    actors = sql(f"SELECT DISTINCT actor FROM {schemas.ops}.action_audit")

    assert actors == [[config["test_user_one_id"]]]


def test_references_use_32_hex_characters(transfer):
    """References use full UUID to avoid collisions."""
    there = transfer("ACC-81001", "ACC-81002", "1.00", new_key())
    back = transfer("ACC-81002", "ACC-81001", "1.00", new_key())

    for result in (there, back):
        assert result.status == "OK"
        assert re.fullmatch(r"[A-Z]{3}-[0-9A-F]{32}", result.reference)


def available(sql, schemas, account_id: str) -> Decimal:
    rows = sql(
        f"SELECT balance + coalesce(credit_limit, 0) FROM {schemas.data}.accounts "
        "WHERE account_id = :account_id",
        {"account_id": account_id},
    )
    return Decimal(rows[0][0])


def at_once(call: Callable[[], object]) -> list[object]:
    """Run call twice concurrently, returning results or conflicts."""

    def attempt():
        try:
            return call()
        except Exception as error:
            if CONFLICT not in str(error):
                raise
            return error

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda _: attempt(), range(2)))
    return outcomes


def status_of(outcome) -> str:
    return "CONFLICT" if isinstance(outcome, Exception) else outcome.status


def move_back(transfer, balances, before: dict[str, str]) -> None:
    moved = Decimal(before["ACC-81001"]) - Decimal(balances()["ACC-81001"])
    if moved:
        transfer("ACC-81002", "ACC-81001", str(moved), new_key())


def test_overlapping_transfers_that_exceed_the_balance_move_money_once(
    transfer, balances, sql, schemas
):
    before = balances()
    amount = (available(sql, schemas, "ACC-81001") * Decimal("0.6")).quantize(
        Decimal("0.01")
    )

    try:
        outcomes = at_once(
            lambda: transfer("ACC-81001", "ACC-81002", str(amount), new_key())
        )

        statuses = sorted(status_of(outcome) for outcome in outcomes)
        assert statuses in (["CONFLICT", "OK"], ["OK", "REJECTED"])
        after = balances()
        assert Decimal(before["ACC-81001"]) - Decimal(after["ACC-81001"]) == amount
        assert Decimal(after["ACC-81001"]) >= 0
    finally:
        move_back(transfer, balances, before)


def test_overlapping_calls_with_one_key_move_money_once(
    transfer, balances, sql, schemas
):
    before = balances()
    key = new_key()

    try:
        outcomes = at_once(lambda: transfer("ACC-81001", "ACC-81002", "1.00", key))

        statuses = sorted(status_of(outcome) for outcome in outcomes)
        assert statuses in (["CONFLICT", "OK"], ["OK", "OK_REPLAYED"])
        references = {
            outcome.reference
            for outcome in outcomes
            if not isinstance(outcome, Exception)
        }
        assert len(references) == 1
        audit = sql(
            f"SELECT count(*) FROM {schemas.ops}.action_audit "
            "WHERE idempotency_key = :key",
            {"key": key},
        )
        assert int(audit[0][0]) == 1
        moved = Decimal(before["ACC-81001"]) - Decimal(balances()["ACC-81001"])
        assert moved == Decimal("1.00")
    finally:
        move_back(transfer, balances, before)
