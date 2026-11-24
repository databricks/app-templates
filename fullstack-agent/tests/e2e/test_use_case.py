import pytest

PERMISSION_ERROR = "PERMISSION_DENIED|INSUFFICIENT_PERMISSIONS"
CUSTOMER_ONE_ACCOUNTS = ["ACC-81001", "ACC-81002", "ACC-81003", "ACC-81098"]


@pytest.mark.user_scope
def test_accounts_are_only_the_users_own(api):
    accounts = api.get("/me/accounts").json()

    assert [account["account_id"] for account in accounts] == CUSTOMER_ONE_ACCOUNTS


@pytest.mark.app_scope
def test_product_data_is_readable_only_through_the_app(api, sql, schemas):
    products = {
        product["product_id"]: product for product in api.get("/products").json()
    }

    assert products["P-EASY-SAVER"]["rate_pct"] == "2.10"
    with pytest.raises(Exception, match=PERMISSION_ERROR):
        sql(f"SELECT product_id FROM {schemas.reference}.products")
