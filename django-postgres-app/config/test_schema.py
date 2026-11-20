"""Tests that search_path and ensure_schema agree on the (quoted) schema name."""

import os
from unittest import mock

from django.core.management import call_command
from django.test import SimpleTestCase

from utils import get_search_path_option


def env(**values):
    return mock.patch.dict(os.environ, values)


class SearchPathOptionTests(SimpleTestCase):
    def test_mixed_case_name_is_quoted(self):
        with env(PGAPPNAME="MyApp", PGUSER="First.Last@example.com"):
            option = get_search_path_option()

        # Unquoted, Postgres would lowercase the name and miss the schema.
        self.assertEqual(option, '-c search_path="MyApp_schema_First.Last@example.com"')

    def test_service_principal_uuid_has_dashes_stripped(self):
        with env(PGAPPNAME="django-postgres-app", PGUSER="1a2b3c4d-0000-4e5f-8a9b-abcdefabcdef"):
            option = get_search_path_option()

        self.assertEqual(
            option,
            '-c search_path="django-postgres-app_schema_1a2b3c4d00004e5f8a9babcdefabcdef"',
        )


class EnsureSchemaAgreementTests(SimpleTestCase):
    def test_ensure_schema_creates_the_schema_search_path_uses(self):
        with env(PGAPPNAME="MyApp", PGUSER="First.Last@example.com"):
            with mock.patch(
                "todos.management.commands.ensure_schema.connection"
            ) as connection:
                cursor = connection.cursor.return_value.__enter__.return_value
                call_command("ensure_schema", stdout=mock.Mock())
            option = get_search_path_option()

        (statement,), _ = cursor.execute.call_args
        created = statement.as_string().removeprefix("CREATE SCHEMA IF NOT EXISTS ")
        self.assertEqual(option, f"-c search_path={created}")
