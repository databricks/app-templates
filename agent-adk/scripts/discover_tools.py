#!/usr/bin/env python3
"""
Discover available tools and data sources for Databricks agents.

This script scans for:
- Unity Catalog functions (data retrieval tools e.g. SQL UDFs)
- Unity Catalog tables (data sources)
- Vector search indexes (RAG data sources)
- Genie spaces (conversational interface over structured data)
- Custom MCP servers (Databricks apps with name mcp-*)
- External MCP servers (via Unity Catalog connections)
"""

import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List

from databricks.sdk import WorkspaceClient

DEFAULT_MAX_RESULTS = 100
DEFAULT_MAX_SCHEMAS = 25

def run_databricks_cli(args: List[str]) -> str:
    """Run databricks CLI command and return output."""
    try:
        result = subprocess.run(
            ["databricks"] + args,
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout
    except subprocess.CalledProcessError as e:
        print(f"Error running databricks CLI: {e.stderr}", file=sys.stderr)
        return ""


def discover_uc_functions(w: WorkspaceClient, catalog: str = None, max_schemas: int = DEFAULT_MAX_SCHEMAS) -> List[Dict[str, Any]]:
    """Discover Unity Catalog functions that could be used as tools.

    Args:
        w: WorkspaceClient instance
        catalog: Optional specific catalog to search
        max_schemas: Total number of schemas to search across all catalogs
    """
    functions = []
    schemas_searched = 0

    try:
        catalogs = [catalog] if catalog else [c.name for c in w.catalogs.list()]

        for cat in catalogs:
            if schemas_searched >= max_schemas:
                break

            try:
                all_schemas = list(w.schemas.list(catalog_name=cat))
                # Take schemas from this catalog until we hit the global budget
                schemas_to_search = all_schemas[:max_schemas - schemas_searched]

                for schema in schemas_to_search:
                    schema_name = f"{cat}.{schema.name}"
                    try:
                        funcs = list(w.functions.list(catalog_name=cat, schema_name=schema.name))
                        for func in funcs:
                            functions.append({
                                "type": "uc_function",
                                "name": func.full_name,
                                "catalog": cat,
                                "schema": schema.name,
                                "function_name": func.name,
                                "comment": func.comment,
                                "routine_definition": getattr(func, "routine_definition", None),
                            })
                    except Exception as e:
                        # Skip schemas we can't access
                        continue
                    finally:
                        schemas_searched += 1
            except Exception as e:
                # Skip catalogs we can't access
                continue

    except Exception as e:
        print(f"Error discovering UC functions: {e}", file=sys.stderr)

    return functions


def discover_uc_tables(w: WorkspaceClient, catalog: str = None, schema: str = None, max_schemas: int = DEFAULT_MAX_SCHEMAS) -> List[Dict[str, Any]]:
    """Discover Unity Catalog tables that could be queried.

    Args:
        w: WorkspaceClient instance
        catalog: Optional specific catalog to search
        schema: Optional specific schema to search (requires catalog)
        max_schemas: Total number of schemas to search across all catalogs
    """
    tables = []
    schemas_searched = 0

    try:
        catalogs = [catalog] if catalog else [c.name for c in w.catalogs.list()]

        for cat in catalogs:
            if cat in ["__databricks_internal", "system"]:
                continue

            if schemas_searched >= max_schemas:
                break

            try:
                if schema:
                    schemas_to_search = [schema]
                else:
                    all_schemas = [s.name for s in w.schemas.list(catalog_name=cat)]
                    # Take schemas from this catalog until we hit the global budget
                    schemas_to_search = all_schemas[:max_schemas - schemas_searched]

                for sch in schemas_to_search:
                    if sch == "information_schema":
                        schemas_searched += 1
                        continue

                    try:
                        tbls = list(w.tables.list(catalog_name=cat, schema_name=sch))
                        for tbl in tbls:
                            # Get column info
                            columns = []
                            if hasattr(tbl, "columns") and tbl.columns:
                                columns = [
                                    {"name": col.name, "type": col.type_name.value if hasattr(col.type_name, "value") else str(col.type_name)}
                                    for col in tbl.columns
                                ]

                            tables.append({
                                "type": "uc_table",
                                "name": tbl.full_name,
                                "catalog": cat,
                                "schema": sch,
                                "table_name": tbl.name,
                                "table_type": tbl.table_type.value if tbl.table_type else None,
                                "comment": tbl.comment,
                                "columns": columns,
                            })
                    except Exception as e:
                        # Skip schemas we can't access
                        pass
                    finally:
                        schemas_searched += 1
            except Exception as e:
                # Skip catalogs we can't access
                continue

    except Exception as e:
        print(f"Error discovering UC tables: {e}", file=sys.stderr)

    return tables


def discover_vector_search_indexes(w: WorkspaceClient) -> List[Dict[str, Any]]:
    """Discover Vector Search indexes for RAG applications."""
    indexes = []

    try:
        # List all vector search endpoints
        endpoints = list(w.vector_search_endpoints.list_endpoints())

        for endpoint in endpoints:
            try:
                # List indexes for each endpoint
                endpoint_indexes = list(w.vector_search_indexes.list_indexes(endpoint_name=endpoint.name))
                for idx in endpoint_indexes:
                    indexes.append({
                        "type": "vector_search_index",
                        "name": idx.name,
                        "endpoint": endpoint.name,
                        "primary_key": idx.primary_key,
                        "index_type": idx.index_type.value if idx.index_type else None,
                        "status": idx.status.state.value if idx.status and idx.status.state else None,
                    })
            except Exception as e:
                # Skip endpoints we can't access
                continue

    except Exception as e:
        print(f"Error discovering vector search indexes: {e}", file=sys.stderr)

    return indexes


def discover_genie_spaces(w: WorkspaceClient) -> List[Dict[str, Any]]:
    """Discover Genie spaces for conversational data access."""
    spaces = []

    try:
        # Use SDK to list genie spaces
        response = w.genie.list_spaces()
        genie_spaces = response.spaces if hasattr(response, "spaces") else []
        for space in genie_spaces:
            spaces.append({
                "type": "genie_space",
                "id": space.space_id,
                "name": space.title,
                "description": space.description,
            })
    except Exception as e:
        print(f"Error discovering Genie spaces: {e}", file=sys.stderr)

    return spaces



def discover_custom_mcp_servers(w: WorkspaceClient) -> List[Dict[str, Any]]:
    """Discover custom MCP servers deployed as Databricks apps."""
    custom_servers = []

    try:
        # List all apps and filter for those starting with mcp-
        apps = w.apps.list()
        for app in apps:
            if app.name and app.name.startswith("mcp-"):
                custom_servers.append({
                    "type": "custom_mcp_server",
                    "name": app.name,
                    "url": app.url,
                    "status": app.app_status.state.value if app.app_status and app.app_status.state else None,
                    "description": app.description,
                })
    except Exception as e:
        print(f"Error discovering custom MCP servers: {e}", file=sys.stderr)

    return custom_servers


def discover_external_mcp_servers(w: WorkspaceClient) -> List[Dict[str, Any]]:
    """Discover external MCP servers configured via Unity Catalog connections."""
    external_servers = []

    try:
        # List all connections and filter for MCP connections
        connections = w.connections.list()
        for conn in connections:
            # Check if this is an MCP connection
            if conn.options and conn.options.get("is_mcp_connection") == "true":
                external_servers.append({
                    "type": "external_mcp_server",
                    "name": conn.name,
                    "connection_type": conn.connection_type.value if hasattr(conn.connection_type, "value") else str(conn.connection_type),
                    "comment": conn.comment,
                    "full_name": conn.full_name,
                })
    except Exception as e:
        print(f"Error discovering external MCP servers: {e}", file=sys.stderr)

    return external_servers


def format_output_markdown(results: Dict[str, List[Dict[str, Any]]]) -> str:
    """Format discovery results as markdown."""
    lines = ["# Agent Tools and Data Sources Discovery\n"]

    # UC Functions
    functions = results.get("uc_functions", [])
    if functions:
        lines.append(f"## Unity Catalog Functions ({len(functions)})\n")
        lines.append("**What they are:** SQL UDFs that can be used as agent tools.\n")
        lines.append("**How to use:** Access via UC functions MCP server:")
        lines.append("- All functions in a schema: `{workspace_host}/api/2.0/mcp/functions/{catalog}/{schema}`")
        lines.append("- Single function: `{workspace_host}/api/2.0/mcp/functions/{catalog}/{schema}/{function_name}`\n")
        for func in functions[:10]:  # Show first 10
            lines.append(f"- `{func['name']}`")
            if func.get("comment"):
                lines.append(f"  - {func['comment']}")
        if len(functions) > 10:
            lines.append(f"\n*...and {len(functions) - 10} more*\n")
        lines.append("")

    # UC Tables
    tables = results.get("uc_tables", [])
    if tables:
        lines.append(f"## Unity Catalog Tables ({len(tables)})\n")
        lines.append("Structured data that agents can query via UC SQL functions.\n")
        for table in tables[:10]:  # Show first 10
            lines.append(f"- `{table['name']}` ({table['table_type']})")
            if table.get("comment"):
                lines.append(f"  - {table['comment']}")
            if table.get("columns"):
                col_names = [c["name"] for c in table["columns"][:5]]
                lines.append(f"  - Columns: {', '.join(col_names)}")
        if len(tables) > 10:
            lines.append(f"\n*...and {len(tables) - 10} more*\n")
        lines.append("")

    # Vector Search Indexes
    indexes = results.get("vector_search_indexes", [])
    if indexes:
        lines.append(f"## Vector Search Indexes ({len(indexes)})\n")
        lines.append("These can be used for RAG applications with unstructured data.\n")
        lines.append("**How to use:** Connect via MCP server at `{workspace_host}/api/2.0/mcp/vector-search/{catalog}/{schema}` or\n")
        lines.append("`{workspace_host}/api/2.0/mcp/vector-search/{catalog}/{schema}/{index_name}`\n")
        for idx in indexes:
            lines.append(f"- `{idx['name']}`")
            lines.append(f"  - Endpoint: {idx['endpoint']}")
            lines.append(f"  - Status: {idx['status']}")
        lines.append("")

    # Genie Spaces
    spaces = results.get("genie_spaces", [])
    if spaces:
        lines.append(f"## Genie Spaces ({len(spaces)})\n")
        lines.append("**What they are:** Natural language interface to your data\n")
        lines.append("**How to use:** Connect via Genie MCP server at `{workspace_host}/api/2.0/mcp/genie/{space_id}`\n")
        for space in spaces:
            lines.append(f"- `{space['name']}` (ID: {space['id']})")
            if space.get("description"):
                lines.append(f"  - {space['description']}")
        lines.append("")

    # Custom MCP Servers (Databricks Apps)
    custom_servers = results.get("custom_mcp_servers", [])
    if custom_servers:
        lines.append(f"## Custom MCP Servers ({len(custom_servers)})\n")
        lines.append("**What:** Your own MCP servers deployed as Databricks Apps (names starting with mcp-)\n")
        lines.append("**How to use:** Access via `{app_url}/mcp`\n")
        lines.append("**⚠️ Important:** Custom MCP server apps require manual permission grants:")
        lines.append("1. Get your agent app's service principal: `databricks apps get <agent-app> --output json | jq -r '.service_principal_name'`")
        lines.append("2. Grant permission: `databricks apps update-permissions <mcp-server-app> --service-principal <sp-name> --permission-level CAN_USE`")
        lines.append("(Apps are not yet supported as resource dependencies in databricks.yml)\n")
        for server in custom_servers:
            lines.append(f"- `{server['name']}`")
            if server.get("url"):
                lines.append(f"  - URL: {server['url']}")
            if server.get("status"):
                lines.append(f"  - Status: {server['status']}")
            if server.get("description"):
                lines.append(f"  - {server['description']}")
        lines.append("")

    # External MCP Servers (UC Connections)
    external_servers = results.get("external_mcp_servers", [])
    if external_servers:
        lines.append(f"## External MCP Servers ({len(external_servers)})\n")
        lines.append("**What:** Third-party MCP servers via Unity Catalog connections\n")
        lines.append("**How to use:** Connect via `{workspace_host}/api/2.0/mcp/external/{connection_name}`\n")
        lines.append("**Benefits:** Secure access to external APIs through UC governance\n")
        for server in external_servers:
            lines.append(f"- `{server['name']}`")
            if server.get("full_name"):
                lines.append(f"  - Full name: {server['full_name']}")
            if server.get("comment"):
                lines.append(f"  - {server['comment']}")
        lines.append("")
    return "\n".join(lines)


def main():
    """Main discovery function."""
    import argparse

    parser = argparse.ArgumentParser(description="Discover available agent tools and data sources")
    parser.add_argument("--catalog", help="Limit discovery to specific catalog")
    parser.add_argument("--schema", help="Limit discovery to specific schema (requires --catalog)")
    parser.add_argument("--format", choices=["json", "markdown"], default="markdown", help="Output format")
    parser.add_argument("--output", help="Output file (default: stdout)")
    parser.add_argument("--profile", help="Databricks CLI profile to use (default: uses default profile)")
    parser.add_argument("--max-results", type=int, default=DEFAULT_MAX_RESULTS, help=f"Maximum results per resource type (default: {DEFAULT_MAX_RESULTS})")
    parser.add_argument("--max-schemas", type=int, default=DEFAULT_MAX_SCHEMAS, help=f"Total schemas to search across all catalogs (default: {DEFAULT_MAX_SCHEMAS})")

    args = parser.parse_args()

    if args.schema and not args.catalog:
        print("Error: --schema requires --catalog", file=sys.stderr)
        sys.exit(1)

    print("Discovering available tools and data sources...", file=sys.stderr)

    # Initialize Databricks workspace client
    # Only pass profile if specified, otherwise use default
    if args.profile:
        w = WorkspaceClient(profile=args.profile)
    else:
        w = WorkspaceClient()

    results = {}

    # Discover each type with configurable limits
    print("- UC Functions...", file=sys.stderr)
    results["uc_functions"] = discover_uc_functions(w, catalog=args.catalog, max_schemas=args.max_schemas)[:args.max_results]

    print("- UC Tables...", file=sys.stderr)
    results["uc_tables"] = discover_uc_tables(w, catalog=args.catalog, schema=args.schema, max_schemas=args.max_schemas)[:args.max_results]

    print("- Vector Search Indexes...", file=sys.stderr)
    results["vector_search_indexes"] = discover_vector_search_indexes(w)[:args.max_results]

    print("- Genie Spaces...", file=sys.stderr)
    results["genie_spaces"] = discover_genie_spaces(w)[:args.max_results]

    print("- Custom MCP Servers (Apps)...", file=sys.stderr)
    results["custom_mcp_servers"] = discover_custom_mcp_servers(w)[:args.max_results]

    print("- External MCP Servers (Connections)...", file=sys.stderr)
    results["external_mcp_servers"] = discover_external_mcp_servers(w)[:args.max_results]

    # Format output
    if args.format == "json":
        output = json.dumps(results, indent=2)
    else:
        output = format_output_markdown(results)

    # Write output
    if args.output:
        Path(args.output).write_text(output)
        print(f"\nResults written to {args.output}", file=sys.stderr)
    else:
        print("\n" + output)

    # Print summary
    print("\n=== Discovery Summary ===", file=sys.stderr)
    print(f"UC Functions: {len(results['uc_functions'])}", file=sys.stderr)
    print(f"UC Tables: {len(results['uc_tables'])}", file=sys.stderr)
    print(f"Vector Search Indexes: {len(results['vector_search_indexes'])}", file=sys.stderr)
    print(f"Genie Spaces: {len(results['genie_spaces'])}", file=sys.stderr)
    print(f"Custom MCP Servers: {len(results['custom_mcp_servers'])}", file=sys.stderr)
    print(f"External MCP Servers: {len(results['external_mcp_servers'])}", file=sys.stderr)


if __name__ == "__main__":
    main()
