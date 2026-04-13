from django.core.management.base import BaseCommand
from django.db import connection
from psycopg.sql import SQL, Identifier
from utils import get_schema_name


class Command(BaseCommand):
    help = "Ensure the database schema exists (CREATE SCHEMA IF NOT EXISTS)."

    def handle(self, *args, **options):
        schema_name = get_schema_name()
        with connection.cursor() as cursor:
            cursor.execute(
                SQL("CREATE SCHEMA IF NOT EXISTS {}").format(Identifier(schema_name))
            )
        self.stdout.write(self.style.SUCCESS(f"Schema '{schema_name}' is ready."))
