import pytest

EXPECTED_COLUMNS = {
    "data.customers": {
        "customer_id",
        "owner_email",
        "full_name",
        "phone",
        "address_line1",
        "city",
        "postcode",
        "national_id",
        "date_of_birth",
        "segment",
        "created_at",
    },
    "data.accounts": {
        "account_id",
        "customer_id",
        "owner_email",
        "account_type",
        "nickname",
        "iban",
        "currency",
        "balance",
        "credit_limit",
        "status",
    },
    "data.transactions": {
        "transaction_id",
        "account_id",
        "owner_email",
        "booked_at",
        "amount",
        "direction",
        "merchant",
        "category",
        "channel",
        "fraud_score",
        "status",
    },
    "data.disputes": {
        "dispute_id",
        "transaction_id",
        "owner_email",
        "reason_code",
        "note",
        "status",
        "created_at",
        "created_by",
    },
    "reference.products": {
        "product_id",
        "name",
        "type",
        "rate_pct",
        "monthly_fee",
        "terms",
    },
}


@pytest.mark.parametrize("table,expected_cols", EXPECTED_COLUMNS.items())
def test_table_columns(table_columns, table: str, expected_cols: set[str]):
    """Bank tables have expected columns, no extras."""
    actual_cols = table_columns(table)
    assert expected_cols == actual_cols, (
        f"Table {table}: expected {expected_cols}, got {actual_cols}"
    )


EXPECTED_CLUSTERING = {
    "data.customers": ["owner_email"],
    "data.accounts": ["owner_email"],
    "data.transactions": ["owner_email"],
    "data.disputes": ["owner_email"],
}


@pytest.mark.parametrize("table,expected_cols", EXPECTED_CLUSTERING.items())
def test_table_clustering(table_clustering, table: str, expected_cols: list[str]):
    """Tables are clustered on owner column in row filter."""
    assert table_clustering(table) == expected_cols
