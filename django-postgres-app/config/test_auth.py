"""Tests for the Databricks Apps authentication middleware and backend."""

import os
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

HEADER = "HTTP_X_FORWARDED_EMAIL"


def env(**overrides):
    """Patch os.environ with the auth variables cleared, plus any overrides."""
    patched = {k: v for k, v in os.environ.items()
               if k not in ("DJANGO_DEV_EMAIL", "DJANGO_SUPERUSERS")}
    patched.update(overrides)
    return mock.patch.dict(os.environ, patched, clear=True)


class AuthTestCase(TestCase):
    def get_user(self, **headers):
        """Request the index page and return the user Django resolved for it."""
        return self.client.get("/", **headers).wsgi_request.user


@override_settings(DEBUG=False)
class HeaderLoginTests(AuthTestCase):
    def test_header_creates_and_logs_in_user(self):
        with env():
            user = self.get_user(**{HEADER: "alice@example.com"})

        self.assertTrue(user.is_authenticated)
        self.assertEqual(user.username, "alice@example.com")
        self.assertEqual(user.email, "alice@example.com")
        self.assertEqual(self.client.session["_auth_user_id"], str(user.pk))

    def test_same_user_keeps_session(self):
        with env():
            self.get_user(**{HEADER: "alice@example.com"})
            session_key = self.client.session.session_key
            user = self.get_user(**{HEADER: "alice@example.com"})

        self.assertEqual(user.username, "alice@example.com")
        self.assertEqual(self.client.session.session_key, session_key)
        self.assertEqual(get_user_model().objects.count(), 1)

    def test_different_user_in_same_session_is_switched(self):
        with env():
            self.get_user(**{HEADER: "alice@example.com"})
            session_key = self.client.session.session_key
            user = self.get_user(**{HEADER: "bob@example.com"})

        self.assertEqual(user.username, "bob@example.com")
        self.assertFalse(user.is_superuser)
        self.assertNotEqual(self.client.session.session_key, session_key)

    def test_no_identity_logs_out(self):
        with env():
            self.get_user(**{HEADER: "alice@example.com"})
            user = self.get_user()

        self.assertFalse(user.is_authenticated)
        self.assertNotIn("_auth_user_id", self.client.session)


class DevEmailFallbackTests(AuthTestCase):
    @override_settings(DEBUG=True)
    def test_used_when_debug_and_no_header(self):
        with env(DJANGO_DEV_EMAIL="dev@example.com"):
            user = self.get_user()

        self.assertTrue(user.is_authenticated)
        self.assertEqual(user.username, "dev@example.com")

    @override_settings(DEBUG=False)
    def test_ignored_when_not_debug(self):
        with env(DJANGO_DEV_EMAIL="dev@example.com"):
            user = self.get_user()

        self.assertFalse(user.is_authenticated)
        self.assertFalse(get_user_model().objects.exists())

    @override_settings(DEBUG=True)
    def test_header_wins_over_dev_email(self):
        with env(DJANGO_DEV_EMAIL="dev@example.com"):
            user = self.get_user(**{HEADER: "alice@example.com"})

        self.assertEqual(user.username, "alice@example.com")

    @override_settings(DEBUG=True)
    def test_no_header_and_no_dev_email_logs_out(self):
        with env():
            self.get_user(**{HEADER: "alice@example.com"})
            user = self.get_user()

        self.assertFalse(user.is_authenticated)


@override_settings(DEBUG=False)
class SuperuserRuleTests(AuthTestCase):
    def test_superusers_list_matches_case_insensitively(self):
        with env(DJANGO_SUPERUSERS=" Admin@Example.com , other@example.com"):
            user = self.get_user(**{HEADER: "admin@example.com"})

        self.assertTrue(user.is_superuser)
        self.assertTrue(user.is_staff)

    def test_user_not_in_superusers_list_is_regular(self):
        with env(DJANGO_SUPERUSERS="admin@example.com"):
            user = self.get_user(**{HEADER: "alice@example.com"})

        self.assertFalse(user.is_superuser)
        self.assertFalse(user.is_staff)

    def test_superusers_list_disables_first_user_rule(self):
        with env(DJANGO_SUPERUSERS="admin@example.com"):
            first = self.get_user(**{HEADER: "alice@example.com"})

        self.assertFalse(first.is_superuser)

    def test_first_user_becomes_superuser_without_list(self):
        with env():
            first = self.get_user(**{HEADER: "alice@example.com"})
            second = self.get_user(**{HEADER: "bob@example.com"})

        self.assertTrue(first.is_superuser)
        self.assertTrue(first.is_staff)
        self.assertFalse(second.is_superuser)
        self.assertFalse(second.is_staff)

    def test_rules_apply_only_when_user_is_created(self):
        with env(DJANGO_SUPERUSERS="admin@example.com"):
            self.get_user(**{HEADER: "alice@example.com"})
        self.client.logout()
        with env(DJANGO_SUPERUSERS="alice@example.com"):
            user = self.get_user(**{HEADER: "alice@example.com"})

        self.assertFalse(user.is_superuser)
