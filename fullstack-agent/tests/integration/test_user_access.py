import pytest


@pytest.fixture(scope="module", autouse=True)
def require_customer_one(sql, config):
    me = sql("SELECT current_user()")[0][0]
    assert me == config["test_user_one_id"], (
        f"these checks run as test user one ({config['test_user_one_id']}), "
        f"not {me}: the sql fixture is using another identity's credentials"
    )


def test_customer_sees_only_own_accounts(sql, schemas):
    rows = sql(
        f"SELECT account_id, account_type, balance FROM {schemas.data}.accounts "
        "ORDER BY account_id"
    )

    assert rows == [
        ["ACC-81001", "CURRENT", "3240.15"],
        ["ACC-81002", "SAVINGS", "8500.00"],
        ["ACC-81003", "CREDIT_CARD", "-612.40"],
        ["ACC-81098", "SAVINGS", None],
    ]


def test_customer_sees_only_own_profile_with_national_id_masked(sql, schemas):
    rows = sql(f"SELECT customer_id, national_id FROM {schemas.data}.customers")

    assert rows == [["CT01", "*******0001"]]


def test_customer_sees_own_transactions_without_fraud_score(sql, config, schemas):
    owners, total, with_score = sql(
        "SELECT count(DISTINCT owner_email), count(*), count(fraud_score) "
        f"FROM {schemas.data}.transactions"
    )[0]

    assert (owners, with_score) == ("1", "0")
    assert int(total) > 40


def test_unrecognised_card_charge_is_last_week(sql, schemas):
    rows = sql(
        "SELECT account_id, amount, datediff(current_date(), CAST(booked_at AS DATE)) "
        f"FROM {schemas.data}.transactions WHERE merchant = 'ELECTROSHOP ONLINE'"
    )

    assert rows == [["ACC-81003", "899.00", "6"]]


def test_customer_cannot_change_a_balance_directly(sql, schemas):
    balance = (
        f"SELECT balance FROM {schemas.data}.accounts WHERE account_id = 'ACC-81001'"
    )
    before = sql(balance)

    with pytest.raises(Exception, match="MODIFY"):
        sql(
            f"UPDATE {schemas.data}.accounts SET balance = 1000000 "
            "WHERE account_id = 'ACC-81001'"
        )

    assert sql(balance) == before


def test_customer_cannot_see_other_customers_by_id(sql, schemas):
    rows = sql(
        f"SELECT count(*) FROM {schemas.data}.accounts "
        "WHERE customer_id = :customer_id",
        {"customer_id": "CT02"},
    )

    assert rows == [["0"]]


def test_customer_reads_only_their_own_activity_and_cannot_write_it(sql, schemas):
    ids = {
        row[0]
        for row in sql(f"SELECT activity_id FROM {schemas.ops}.assistant_activity")
    }

    assert {"CT01-RUN-1:1", "CT01-RUN-0:1"} <= ids
    assert not [activity_id for activity_id in ids if activity_id.startswith("CT02-")]
    with pytest.raises(Exception, match="MODIFY"):
        sql(
            f"INSERT INTO {schemas.ops}.assistant_activity (activity_id, owner_email) "
            "VALUES ('CT01-FORGED:1', current_user())"
        )
