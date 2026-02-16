#!/usr/bin/env python3
"""
Create Unity Catalog tables for OpenTelemetry trace storage using UC API.
"""

import os
import sys

# Use databricks SDK
try:
    from databricks.sdk import WorkspaceClient
    from databricks.sdk.service.catalog import (
        ColumnInfo,
        ColumnTypeName,
        DataSourceFormat,
        TableType,
    )
except ImportError:
    print("❌ Error: databricks-sdk not installed")
    print("Run: pip install databricks-sdk")
    sys.exit(1)


def create_otel_table():
    """Create OTel spans table using Unity Catalog API."""

    print("🔌 Connecting to Databricks...")

    try:
        # Create workspace client (uses default auth from databricks CLI)
        w = WorkspaceClient(profile="dogfood")

        # Get current user
        user = w.current_user.me()
        print(f"✅ Authenticated as: {user.user_name}")

        catalog_name = "main"
        schema_name = "agent_traces"
        table_name = "otel_spans"
        full_name = f"{catalog_name}.{schema_name}.{table_name}"

        print(f"\n📋 Creating table: {full_name}")

        # Define table columns
        columns = [
            ColumnInfo(
                name="trace_id",
                type_name=ColumnTypeName.STRING,
                type_text="string",
                comment="Unique identifier for the trace",
                nullable=True,
                position=0,
            ),
            ColumnInfo(
                name="span_id",
                type_name=ColumnTypeName.STRING,
                type_text="string",
                comment="Unique identifier for the span",
                nullable=True,
                position=1,
            ),
            ColumnInfo(
                name="parent_span_id",
                type_name=ColumnTypeName.STRING,
                type_text="string",
                comment="Parent span ID (null for root spans)",
                nullable=True,
                position=2,
            ),
            ColumnInfo(
                name="name",
                type_name=ColumnTypeName.STRING,
                type_text="string",
                comment="Span name",
                nullable=True,
                position=3,
            ),
            ColumnInfo(
                name="kind",
                type_name=ColumnTypeName.STRING,
                type_text="string",
                comment="Span kind",
                nullable=True,
                position=4,
            ),
            ColumnInfo(
                name="start_time",
                type_name=ColumnTypeName.TIMESTAMP,
                type_text="timestamp",
                comment="Span start timestamp",
                nullable=True,
                position=5,
            ),
            ColumnInfo(
                name="end_time",
                type_name=ColumnTypeName.TIMESTAMP,
                type_text="timestamp",
                comment="Span end timestamp",
                nullable=True,
                position=6,
            ),
            ColumnInfo(
                name="attributes",
                type_name=ColumnTypeName.MAP,
                type_text="map<string,string>",
                comment="Span attributes",
                nullable=True,
                position=7,
            ),
            ColumnInfo(
                name="events",
                type_name=ColumnTypeName.ARRAY,
                type_text="array<struct<timestamp:timestamp,name:string,attributes:map<string,string>>>",
                comment="Span events",
                nullable=True,
                position=8,
            ),
            ColumnInfo(
                name="status_code",
                type_name=ColumnTypeName.STRING,
                type_text="string",
                comment="Span status code",
                nullable=True,
                position=9,
            ),
            ColumnInfo(
                name="status_message",
                type_name=ColumnTypeName.STRING,
                type_text="string",
                comment="Status message",
                nullable=True,
                position=10,
            ),
            ColumnInfo(
                name="resource_attributes",
                type_name=ColumnTypeName.MAP,
                type_text="map<string,string>",
                comment="Resource attributes",
                nullable=True,
                position=11,
            ),
        ]

        # Create the table (storage_location=None for managed tables)
        table = w.tables.create(
            name=table_name,
            catalog_name=catalog_name,
            schema_name=schema_name,
            table_type=TableType.MANAGED,
            data_source_format=DataSourceFormat.DELTA,
            columns=columns,
            storage_location=None,
        )

        print(f"✅ Table created: {table.full_name}")
        print(f"   Table ID: {table.table_id}")

        # Verify table exists
        print("\n📊 Verifying table...")
        table_info = w.tables.get(full_name)
        print(f"✅ Table verified: {table_info.full_name}")
        print(f"   Columns: {len(table_info.columns)}")
        print(f"   Owner: {table_info.owner}")

        print("\n✅ All done! Table ready for OTel traces.")
        print("\n📝 Configuration:")
        print(f"   OTEL_UC_TABLE_NAME={full_name}")
        print("\n📝 Next steps:")
        print("   1. Verify .env has: OTEL_UC_TABLE_NAME=main.agent_traces.otel_spans")
        print("   2. Test locally: npm run dev:agent")
        print("   3. Send test request and check for traces")

        return True

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = create_otel_table()
    sys.exit(0 if success else 1)
