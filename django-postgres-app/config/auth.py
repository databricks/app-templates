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
"""

import os

from django.contrib.auth import authenticate, login
from django.contrib.auth.backends import RemoteUserBackend


class DatabricksAppsMiddleware:
    """Authenticate users via the X-Forwarded-Email header set by Databricks Apps."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        email = request.META.get("HTTP_X_FORWARDED_EMAIL")
        if not email:
            email = os.environ.get("DJANGO_DEV_EMAIL")
        if email and not request.user.is_authenticated:
            user = authenticate(request, remote_user=email)
            if user:
                request.user = user
                login(request, user)
        elif not email and request.user.is_authenticated:
            # Header gone (e.g. local testing) — log out.
            from django.contrib.auth import logout

            logout(request)
        return self.get_response(request)


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
