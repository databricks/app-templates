#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""

# --- diagnostics bootstrap: install crash/exception logging before app code ---
import os as _diag_os
import sys as _diag_sys

_diag_dir = _diag_os.path.dirname(_diag_os.path.abspath(__file__))
if _diag_dir not in _diag_sys.path:
    _diag_sys.path.insert(0, _diag_dir)
import app_diagnostics  # noqa: E402

app_diagnostics.install_diagnostics()
# --- end diagnostics bootstrap ---

import os
import sys


def main():
    """Run administrative tasks."""
    # `manage.py test` runs against in-memory SQLite (config/test_settings.py),
    # so it needs no Lakebase connection. An explicit setting still wins.
    is_test = sys.argv[1:2] == ["test"]
    default_settings = "config.test_settings" if is_test else "config.settings"
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", default_settings)
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
