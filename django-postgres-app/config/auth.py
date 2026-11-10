"""
Databricks Apps authentication for Django.

Databricks Apps authenticates users before requests reach the app and
forwards the user's email in the X-Forwarded-Email header. This module
wires that header into Django's RemoteUser infrastructure so that:
  - Every authenticated Databricks user gets a Django user automatically.
  - If DJANGO_SUPERUSERS is set (comma-separated emails), those users
    are granted staff + superuser access on first login.
  - Otherwise, the first user to access the app becomes the superuser.
    Additional superusers can be managed via the admin portal.
  - The session always follows the forwarded user: if a different
    Databricks user shows up in the same browser, the previous session is
    logged out and the new user is logged in. If the header is missing,
    the session is logged out.
  - For local development (DEBUG=True only), DJANGO_DEV_EMAIL stands in
    for the header, which is not present outside Databricks Apps.
"""

import os

from django.conf import settings
from django.contrib.auth.backends import RemoteUserBackend
from django.contrib.auth.middleware import RemoteUserMiddleware


class DatabricksAppsMiddleware(RemoteUserMiddleware):
    """Authenticate users via the X-Forwarded-Email header set by Databricks Apps.

    Django's RemoteUserMiddleware compares the session user with the header
    on every request and re-authenticates when they differ.
    """

    header = "HTTP_X_FORWARDED_EMAIL"

    def __call__(self, request):
        if settings.DEBUG and self.header not in request.META:
            dev_email = os.environ.get("DJANGO_DEV_EMAIL")
            if dev_email:
                request.META[self.header] = dev_email
        return super().__call__(request)


class DatabricksAppsBackend(RemoteUserBackend):
    create_unknown_user = True

    def configure_user(self, request, user, created=False):
        if created:
            from django.contrib.auth import get_user_model

            User = get_user_model()
            user.email = user.username

            superuser_csv = os.environ.get("DJANGO_SUPERUSERS", "")
            if superuser_csv.strip():
                superuser_emails = {
                    e.strip().lower() for e in superuser_csv.split(",") if e.strip()
                }
                is_superuser = user.email.lower() in superuser_emails
            else:
                # No explicit list — first user becomes superuser.
                is_superuser = not User.objects.filter(is_superuser=True).exists()

            if is_superuser:
                user.is_staff = True
                user.is_superuser = True
            user.save()
        return user
