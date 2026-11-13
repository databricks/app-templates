# --- diagnostics bootstrap: install crash/exception logging before app code ---
import os as _diag_os
import sys as _diag_sys

_diag_dir = _diag_os.path.dirname(_diag_os.path.abspath(__file__))
if _diag_dir not in _diag_sys.path:
    _diag_sys.path.insert(0, _diag_dir)
import app_diagnostics  # noqa: E402

app_diagnostics.install_diagnostics()
# --- end diagnostics bootstrap ---

import asyncio
import os

import sqlglot
from sqlglot import exp
from databricks.sdk import config
from databricks import sql
from shiny import App, ui, render, reactive, run_app

from security import SecurityMiddleware

# Defined in `app.yaml`
SQL_WAREHOUSE_ID = os.getenv("DATABRICKS_WAREHOUSE_ID")
assert SQL_WAREHOUSE_ID, "DATABRICKS_WAREHOUSE_ID must be set in app.yaml."

_INITIAL_QUERY = """
SELECT
  *
FROM
  samples.nyctaxi.trips
"""

MAX_QUERY_CHARS = 10000
_ALLOWED_COMMANDS = frozenset({"SHOW", "DESCRIBE", "DESC", "EXPLAIN"})
# Write / DDL / session nodes. sqlglot has no Optimize class; OPTIMIZE parses as Command.
_DISALLOWED_NODES = (
    exp.Insert,
    exp.Update,
    exp.Delete,
    exp.Merge,
    exp.Create,
    exp.Drop,
    exp.Alter,
    exp.TruncateTable,
    exp.Command,
    exp.Set,
    exp.Use,
    exp.Copy,
    exp.Cache,
    exp.Refresh,
    exp.Analyze,
    exp.Uncache,
    exp.Grant,
    exp.Revoke,
    exp.Comment,
    exp.Pragma,
    exp.Transaction,
    exp.Commit,
    exp.Rollback,
    exp.Kill,
    exp.LoadData,
    exp.Clone,
    exp.Attach,
    exp.Detach,
    exp.Export,
    exp.Install,
)
_DISALLOWED_TYPE_NAMES = frozenset({"Optimize", "Vacuum"})
_READ_ONLY_ERROR = (
    "Only a single read-only query can be run "
    "(SELECT/WITH, SHOW, DESCRIBE, or EXPLAIN of a SELECT)."
)


def _is_read_query(node):
    """SELECT, UNION/INTERSECT/EXCEPT of those, or WITH whose body is a SELECT."""
    if node is None:
        return False
    if isinstance(node, exp.Subquery):
        return _is_read_query(node.this)
    if isinstance(node, exp.Paren):
        return _is_read_query(node.this)
    if isinstance(node, exp.Select):
        return True
    if isinstance(node, (exp.Union, exp.Intersect, exp.Except)):
        return _is_read_query(node.this) and _is_read_query(node.expression)
    if isinstance(node, exp.With):
        return _is_read_query(node.this)
    return False


def _contains_disallowed(tree, skip=None):
    for node in tree.walk():
        if skip is not None and node is skip:
            continue
        if isinstance(node, _DISALLOWED_NODES):
            return True
        if type(node).__name__ in _DISALLOWED_TYPE_NAMES:
            return True
    return False


def _command_payload(node):
    expr = node.expression
    if expr is None:
        return ""
    if isinstance(expr, exp.Literal):
        return str(expr.this or "")
    return expr.sql() if hasattr(expr, "sql") else str(expr)


def _parse_statements(sql):
    try:
        trees = sqlglot.parse(sql, read="databricks")
    except sqlglot.errors.SqlglotError:
        return None
    except Exception:
        return None
    return [tree for tree in trees if tree is not None]


def _allow_command(root):
    # sqlglot returns SHOW / EXPLAIN (and sometimes DESCRIBE) as exp.Command.
    keyword = str(root.this or "").strip()
    if keyword.upper() not in _ALLOWED_COMMANDS:
        return _READ_ONLY_ERROR
    if _contains_disallowed(root, skip=root):
        return _READ_ONLY_ERROR
    if keyword.upper() != "EXPLAIN":
        return None
    wrapped = _command_payload(root).strip()
    if not wrapped:
        return "EXPLAIN is only allowed for a SELECT statement."
    inner = _parse_statements(wrapped)
    if inner is None:
        # Options such as EXPLAIN EXTENDED/FORMATTED/COST are not classified.
        return "EXPLAIN is only allowed for a SELECT statement."
    if len(inner) != 1 or not _is_read_query(inner[0]) or _contains_disallowed(inner[0]):
        return "EXPLAIN is only allowed for a SELECT statement."
    return None


def validate_query(statement):
    """
    Returns an error message unless `statement` is a single read-only query.

    Queries run as the app's service principal, so this keeps the playground
    read-only. Unity Catalog grants remain the real limit on what can be read;
    SELECTs that call side-effecting functions (for example ai_query) are not
    blocked.
    """
    if len(statement) > MAX_QUERY_CHARS:
        return f"Queries are limited to {MAX_QUERY_CHARS} characters."
    trees = _parse_statements(statement)
    if trees is None:
        return "The SQL could not be parsed."
    if len(trees) == 0:
        return "A SQL statement is required."
    if len(trees) != 1:
        return "Only a single statement can be run."
    root = trees[0]
    if isinstance(root, exp.Command):
        return _allow_command(root)
    if isinstance(root, exp.Describe):
        if _contains_disallowed(root):
            return _READ_ONLY_ERROR
        inner = root.this
        if inner is not None and not isinstance(inner, (exp.Table, exp.Column, exp.Identifier)):
            if not _is_read_query(inner):
                return _READ_ONLY_ERROR
        return None
    if not _is_read_query(root) or _contains_disallowed(root):
        return _READ_ONLY_ERROR
    return None


def execute_query(connection, statement, max_rows=10000):
    """
    Executes an SQL statement and fetches up to `max_rows` results.
    """
    try:
        with connection.cursor() as cursor:
            cursor.execute(statement)
            res = (
                cursor.fetchmany_arrow(max_rows)
                if max_rows
                else cursor.fetchall_arrow()
            )
        return res
    except Exception as e:
        print(f"Error executing query: {e}")
        return e


app_ui = ui.page_navbar(
    ui.nav_panel(
        "Query",
        # text input formatted to use monospace font
        ui.tags.head(ui.tags.style("#sql_query {font-family: monospace;}")),
        ui.p(
            "Queries run with the app's service principal identity, not your own permissions, "
            "so you can read any data the app can read. Only a single read-only query is allowed "
            "(SELECT/WITH, SHOW, DESCRIBE, or EXPLAIN of a SELECT); a maximum of 10k rows will be "
            "returned and a timeout of 60s is set."
        ),
        ui.input_text_area(
            "sql_query", label="", rows=6, value=_INITIAL_QUERY, width="100%"
        ),
        ui.span(
            ui.input_task_button(
                "submit_query", label="Run Query", width="79%", class_="btn-primary"
            ),
            ui.input_action_button(
                "cancel_query",
                label="Cancel Query",
                width="20%",
                class_="btn-warning",
                disabled=True,
            ),
            class_="inline",
        ),
        ui.hr(),
        ui.output_data_frame("query_results"),
    ),
    title="Data Playground",
)


def server(input, output, session):
    # Authenticate as the app's service principal
    cfg = config.Config()

    # Define the extended task to execute the query asynchronously
    @ui.bind_task_button(button_id="submit_query")
    @reactive.extended_task
    async def run_query_task(query: str):
        try:
            # Connect to SQL warehouse inside the task to ensure thread safety
            connection = sql.connect(
                server_hostname=cfg.host,
                http_path=f"/sql/1.0/warehouses/{SQL_WAREHOUSE_ID}",
                credentials_provider=lambda: cfg.authenticate,
                session_configuration={"STATEMENT_TIMEOUT": "60"},
            )
            res = await asyncio.to_thread(execute_query, connection, query)
            ui.update_action_button("cancel_query", disabled=True)
            return res
        except Exception as e:
            return e

    # Start the task when the 'Run Query' button is pressed
    @reactive.effect
    @reactive.event(input.submit_query)
    def handle_query():
        ui.update_action_button("cancel_query", disabled=False)
        # Don't attempt execution for empty queries
        query = input.sql_query()
        if not query.strip():
            ui.notification_show("Please enter a SQL query.", type="warning")
            return
        error = validate_query(query)
        if error:
            ui.update_action_button("cancel_query", disabled=True)
            ui.notification_show(error, type="warning")
            return
        run_query_task(query)

    # Handle the 'Cancel Query' button
    @reactive.effect
    @reactive.event(input.cancel_query)
    def handle_cancel():
        ui.update_action_button("cancel_query", disabled=True)
        ui.notification_show("Cancelling query", type="info")
        run_query_task.cancel()

    # Display the query results
    @render.data_frame
    def query_results():
        res = run_query_task.result()
        if isinstance(res, Exception):
            ui.notification_show(
                f"Error executing query: {res}", type="error", duration=12
            )
            return None
        elif res:
            return render.DataGrid(
                res.to_pandas(), height="700px", width="100%", filters=True
            )
        else:
            return None


app = SecurityMiddleware(App(app_ui, server))

if __name__ == "__main__":
    run_app("app:app")
