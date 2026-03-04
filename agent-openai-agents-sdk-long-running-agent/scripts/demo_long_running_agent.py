#!/usr/bin/env python3
"""
Demo script for the long-running agent's Responses API.

Uses DatabricksOpenAI to demonstrate background
polling and streaming with reconnect. Mirrors the flows in the OpenAI background
streaming guide:

    https://developers.openai.com/api/docs/guides/background/#streaming-a-background-response

Output is rendered as formatted text in the terminal (not raw events). Tool
runs show "Running <tool>..." while executing and "✓ <tool> completed" when done.


Examples
--------

  poll
      Background + Poll. Uses ``client.responses.create(..., background=True)``,
      then polls ``client.responses.retrieve(id)`` until completion. Best for
      simple, short-running requests where you don't need incremental output.

  stream
      Background + Stream with reconnect. Supports two API styles via ``--stream-api``:
      - Default (retrieve): ``create(stream=True)`` for trigger, ``retrieve(stream=True)`` for resume
      - With ``--stream-api``: ``stream(input=..., background=True)`` for both create and resume
      With ``--no-cursor``, resume without starting_after: streams all content again
      from the start upon resumption (no deduplication—you will see duplicate output).
      Tenacity retries on connection errors. Use ``--long`` for retry testing.


API paths (how to run)
----------------------

  1. retrieve stream=False
     Poll until completion. No streaming.
     Run:  uv run python scripts/demo_long_running_agent.py poll

  2. retrieve stream=True, with cursor
     Stream via create+retrieve, resume with starting_after.
     Run:  uv run python scripts/demo_long_running_agent.py stream

  3. retrieve stream=True, no cursor
     Stream via create+retrieve, resume without starting_after. Streams all content
     again from the start upon resumption (no deduplication).
     Run:  uv run python scripts/demo_long_running_agent.py stream --no-cursor

  4. stream with cursor
     Use client.responses.stream() for both create and resume, with starting_after.
     Run:  uv run python scripts/demo_long_running_agent.py stream --stream-api

  5. stream without cursor
     Use client.responses.stream() for both create and resume, no starting_after.
     Streams all content again from the start upon resumption (no deduplication).
     Run:  uv run python scripts/demo_long_running_agent.py stream --stream-api --no-cursor


CLI options
----------

  example          One of: poll, stream (default: stream)
  -e, --example   Same as positional
  --url           Agent server URL (default: http://localhost:8000)
  -p, --profile   Databricks config profile for OAuth (sets DATABRICKS_CONFIG_PROFILE)
  -l, --long      Use long prompt (14 iterations; connection drop more likely for stream)
  --no-cursor     For stream: resume without starting_after (streams all
                  content again from start upon resumption; no deduplication)
  --stream-api    For stream: use client.responses.stream() instead of create+retrieve.
  --max-retries   Max reconnect attempts (default: 5)
  --max-retry-sec Max seconds since start before giving up (default: 600)
  --raw-events    Output raw JSON events instead of parsed/formatted output


Usage examples
--------------

    # Local (default http://localhost:8000, no auth required):
    uv run python scripts/demo_long_running_agent.py stream

    # Retry testing, raw events
    uv run python scripts/demo_long_running_agent.py stream --long
    uv run python scripts/demo_long_running_agent.py stream --raw-events

    # With options
    uv run python scripts/demo_long_running_agent.py -e stream --url https://my-app.aws.databricksapps.com
    uv run python scripts/demo_long_running_agent.py poll --profile ps

    # Databricks app (OAuth; run databricks auth login first):
    uv run python scripts/demo_long_running_agent.py stream --url https://my-app.aws.databricksapps.com

    uv run python scripts/demo_long_running_agent.py --help
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    stop_after_delay,
    stop_any,
    wait_none,
)

from openai import APIError, OpenAI
from databricks_openai import DatabricksOpenAI
from databricks.sdk import WorkspaceClient

# ANSI codes for modern terminal formatting
DIM = "\033[2m"
BOLD = "\033[1m"
CYAN = "\033[36m"
GREEN = "\033[32m"
RED = "\033[31m"
RESET = "\033[0m"


def _get_event_attr(evt: object, key: str, default=None):
    """Get attribute from event (handles both objects and dicts)."""
    if isinstance(evt, dict):
        return evt.get(key, default)
    return getattr(evt, key, default)


def _to_serializable(obj: object) -> object:
    """Convert event/response to JSON-serializable dict."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return {k: _to_serializable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_to_serializable(x) for x in obj]
    if hasattr(obj, "model_dump"):
        return _to_serializable(obj.model_dump())
    if isinstance(obj, (str, int, float, bool)):
        return obj
    if hasattr(obj, "__dict__"):
        return _to_serializable({k: v for k, v in vars(obj).items() if not k.startswith("_")})
    return str(obj)


def _process_event(evt: object, tool_call_state: dict[str, str] | None = None) -> str | None:
    """Extract displayable text from a Responses API streaming event.

    Returns None if nothing to show. Handles output_text deltas, function_call
    progress, function_call_output (full output as-is), and message content.

    tool_call_state: optional dict mapping call_id -> tool name; used to show
    "completed" only when the tool result arrives (not when the call finishes).
    """
    state = tool_call_state if tool_call_state is not None else {}
    evt_type = _get_event_attr(evt, "type") or _get_event_attr(evt, "event")
    if not evt_type:
        return None

    # Ignore function call argument events (not user-facing)
    if evt_type in ("response.function_call_arguments.delta", "response.function_call_arguments.done"):
        return None

    if evt_type == "error":
        error = _get_event_attr(evt, "error")
        if isinstance(error, dict):
            msg = error.get("message", "Unknown error")
            code = error.get("code", "")
            return f"\n{RED}{BOLD}  ✗  Error{f' ({code})' if code else ''}: {msg}{RESET}\n"
        return f"\n{RED}{BOLD}  ✗  Error: {error}{RESET}\n"

    if evt_type == "response.output_text.delta":
        delta = _get_event_attr(evt, "delta")
        if delta and isinstance(delta, str):
            s = delta.strip()
            if (s.startswith("{") and ("code" in delta or "arguments" in delta)) or "functions." in delta:
                return None
            return delta

    if evt_type == "response.output_text.done":
        text = _get_event_attr(evt, "text")
        if text and isinstance(text, str):
            return f"\n{text}\n"

    if evt_type == "response.output_item.added":
        item = _get_event_attr(evt, "item")
        if item:
            item_type = _get_event_attr(item, "type") if isinstance(item, dict) else getattr(item, "type", None)
            name = _get_event_attr(item, "name") if isinstance(item, dict) else getattr(item, "name", None)
            call_id = _get_event_attr(item, "call_id") if isinstance(item, dict) else getattr(item, "call_id", None)
            if item_type == "function_call" and name and call_id:
                state[call_id] = name
                return f"\n{DIM}  ⚙  Running {name}...{RESET}\n"

    if evt_type == "response.output_item.done":
        item = _get_event_attr(evt, "item")
        if item:
            item_type = _get_event_attr(item, "type") if isinstance(item, dict) else getattr(item, "type", None)
            name = _get_event_attr(item, "name") if isinstance(item, dict) else getattr(item, "name", None)
            call_id = _get_event_attr(item, "call_id") if isinstance(item, dict) else getattr(item, "call_id", None)
            if item_type == "function_call" and name and call_id:
                state[call_id] = name
                return None  # Don't show "completed" yet — wait for function_call_output
            if item_type == "function_call_output":
                output = _get_event_attr(item, "output")
                tool_name = state.pop(call_id, None) if call_id else None
                name_str = tool_name or "Tool"
                lines = [f"{DIM}  ✓  {name_str} completed{RESET}\n"]
                if isinstance(output, str) and output.strip():
                    lines.append(f"{DIM}  →  result:{RESET}\n{output}\n")
                return "".join(lines)
            if item_type == "message":
                content = _get_event_attr(item, "content")
                if isinstance(content, list):
                    for c in content:
                        if isinstance(c, dict) and c.get("type") == "output_text":
                            text = c.get("text", "")
                            if text:
                                return f"\n{text}\n"

    return None


def _print_stream_header(response_id: str | None = None) -> None:
    """Print a styled header before streaming output."""
    print(f"\n{CYAN}{BOLD}Output{RESET}")
    if response_id:
        print(f"{DIM}Response ID: {response_id}{RESET}")
    print(f"{DIM}{'─' * 60}{RESET}\n", end="", flush=True)


def _print_stream_footer(
    response_id: str | None = None,
    trace_id: str | None = None,
) -> None:
    """Print a styled footer after streaming completes."""
    print(f"\n{DIM}{'─' * 60}{RESET}")
    line = f"{GREEN}✓ Stream complete{RESET}"
    if response_id:
        line += f" {DIM}(response_id: {response_id}){RESET}"
    if trace_id:
        line += f"\n{DIM}Trace ID: {trace_id}{RESET}"
    print(f"{line}\n", flush=True)


AGENT_APP_URL = "http://localhost:8000"  # Set from args.url in main()

# Prompts
PROMPT_STANDARD = (
    "Use Python to generate a random number between 100 and 200. "
    "Once you have the number, compose a Shakespearean-style poem containing roughly that many words. "
    "Write the poem yourself rather than using a tool. No need to verify in the end."
)
PROMPT_LONG_RUNNING = (
    PROMPT_STANDARD
    + " Repeat the above process 19 times and do not run these in parallel but rather one at a time."
)


TRACE_HEADER = "x-mlflow-return-trace-id"
TRACE_HEADERS = {TRACE_HEADER: "true"}


def get_client() -> OpenAI | DatabricksOpenAI:
    """Create client for the configured agent target.

    - Local (localhost): OpenAI client with placeholder api_key (no auth required)
    - Databricks URL: DatabricksOpenAI with WorkspaceClient (OAuth; uses
      DATABRICKS_CONFIG_PROFILE from env if set)
    """
    is_local = "localhost" in AGENT_APP_URL or "127.0.0.1" in AGENT_APP_URL

    if is_local:
        return OpenAI(base_url=AGENT_APP_URL, api_key="local")

    return DatabricksOpenAI(workspace_client=WorkspaceClient(), base_url=AGENT_APP_URL)


# Connection-drop errors that we can recover from by resuming via GET
_RESUMABLE_EXCEPTIONS = (
    "RemoteProtocolError",
    "ReadTimeout",
    "ConnectError",
    "ConnectTimeout",
    "RemoteDisconnected",
    "ConnectionResetError",
    "BrokenPipeError",
    "IncompleteRead",
)


def _is_resumable_error(exc: BaseException) -> bool:
    """True if this error indicates a connection drop we can resume from."""
    name = type(exc).__name__
    if name in _RESUMABLE_EXCEPTIONS:
        return True
    if "remote" in name.lower() and "protocol" in name.lower():
        return True
    if "connection" in name.lower() and ("reset" in name.lower() or "closed" in str(exc).lower()):
        return True
    return False


# ---------------------------------------------------------------------------
# Example 1: Background + Poll (no streaming)
# ---------------------------------------------------------------------------
def example_poll(prompt: str, raw_events: bool = False) -> None:
    """
    Create a background response and poll until completion.
    https://developers.openai.com/api/docs/guides/background/#polling-background-responses
    """
    print("=== Example 1: Background + Poll ===\n")
    client = get_client()

    print("POST with background=true...")
    resp = client.responses.create(
        input=[{"role": "user", "content": prompt}],
        background=True,
        extra_headers=TRACE_HEADERS,
    )

    response_id = resp.id
    print(f"Response ID: {response_id}\n")

    while resp.status in ("queued", "in_progress"):
        print(f"  Status: {resp.status}")
        time.sleep(2)
        resp = client.responses.retrieve(response_id, extra_headers=TRACE_HEADERS)

    print(f"\nFinal status: {resp.status}")

    if resp.status == "failed":
        error = getattr(resp, "error", None)
        if error:
            msg = error.get("message", str(error)) if isinstance(error, dict) else getattr(error, "message", str(error))
            code = error.get("code", "") if isinstance(error, dict) else getattr(error, "code", "")
            print(f"\n{RED}{BOLD}  ✗  Error{f' ({code})' if code else ''}: {msg}{RESET}\n")
        else:
            print(f"\n{RED}{BOLD}  ✗  Task failed (no error details){RESET}\n")
        return

    trace_id = None
    if hasattr(resp, "metadata") and resp.metadata:
        meta = resp.metadata
        trace_id = meta.get("trace_id") if isinstance(meta, dict) else getattr(meta, "trace_id", None)
    if raw_events:
        _print_stream_header(response_id)
        d = _to_serializable(resp)
        print(json.dumps(d, indent=2))
        _print_stream_footer(response_id, trace_id=trace_id)
    elif hasattr(resp, "output_text") and resp.output_text:
        _print_stream_header(response_id)
        print(resp.output_text, end="", flush=True)
        _print_stream_footer(response_id, trace_id=trace_id)
    elif hasattr(resp, "output") and resp.output:
        _print_stream_header(response_id)
        for item in resp.output:
            if isinstance(item, dict):
                content = item.get("content", [])
                for c in content if isinstance(content, list) else [content]:
                    if isinstance(c, dict) and c.get("type") == "output_text":
                        print(c.get("text", ""), end="", flush=True)
        _print_stream_footer(response_id, trace_id=trace_id)


# ---------------------------------------------------------------------------
# Example 2a: Stream via create(stream=True) + retrieve(stream=True)
# ---------------------------------------------------------------------------
def _run_stream_create_retrieve(
    client: OpenAI | DatabricksOpenAI,
    prompt: str,
    use_cursor: bool,
    max_retries: int,
    max_retry_seconds: int,
    raw_events: bool = False,
) -> None:
    """Use client.responses.create() and client.responses.retrieve() with stream=True."""
    response_id = None
    cursor = 0
    trace_id = None

    def should_retry(exc: BaseException) -> bool:
        if not _is_resumable_error(exc):
            return False
        if response_id is None:
            return False
        return True

    @retry(
        stop=stop_any(stop_after_attempt(max_retries), stop_after_delay(max_retry_seconds)),
        wait=wait_none(),
        retry=retry_if_exception(should_retry),
        reraise=True,
    )
    def stream_with_reconnect() -> None:
        nonlocal response_id, cursor, trace_id

        if response_id is not None:
            start_after = cursor if use_cursor else None
            qs = f"&starting_after={cursor}" if use_cursor else ""
            print(
                f"\n{DIM}  Resuming via GET /responses/{response_id}?stream=true{qs}{RESET}\n",
                flush=True,
            )
            stream = client.responses.retrieve(
                response_id,
                stream=True,
                starting_after=start_after,
                extra_headers=TRACE_HEADERS,
            )
        else:
            stream = client.responses.create(
                input=[{"role": "user", "content": prompt}],
                background=True,
                stream=True,
                extra_headers=TRACE_HEADERS,
            )

        tool_call_state: dict[str, str] = {}
        for event in stream:
            seq = _get_event_attr(event, "sequence_number")
            if seq is not None and use_cursor:
                cursor = seq

            if response_id is None:
                resp = _get_event_attr(event, "response")
                if resp is not None:
                    response_id = _get_event_attr(resp, "id")
                if response_id:
                    print(f"{DIM}Response ID: {response_id}{RESET}\n", end="", flush=True)

            tid = _get_event_attr(event, "trace_id")
            if tid is not None:
                trace_id = tid
            if raw_events:
                d = _to_serializable(event)
                print(json.dumps(d, indent=2))
            else:
                text = _process_event(event, tool_call_state)
                if text:
                    sys.stdout.write(text)
                    sys.stdout.flush()

    stream_with_reconnect()
    _print_stream_footer(response_id, trace_id=trace_id)


# ---------------------------------------------------------------------------
# Example 2b: Stream via client.responses.stream()
# ---------------------------------------------------------------------------
def _run_stream_api(
    client: OpenAI | DatabricksOpenAI,
    prompt: str,
    use_cursor: bool,
    max_retries: int,
    max_retry_seconds: int,
    raw_events: bool = False,
) -> None:
    """Use client.responses.stream() for both create and resume."""
    response_id = None
    cursor = 0
    trace_id = None

    def should_retry(exc: BaseException) -> bool:
        if not _is_resumable_error(exc):
            return False
        if response_id is None:
            return False
        return True

    @retry(
        stop=stop_any(stop_after_attempt(max_retries), stop_after_delay(max_retry_seconds)),
        wait=wait_none(),
        retry=retry_if_exception(should_retry),
        reraise=True,
    )
    def stream_with_reconnect() -> None:
        nonlocal response_id, cursor, trace_id

        if response_id is not None:
            start_after = cursor if use_cursor else None
            print(
                f"\n{DIM}  Resuming via stream(response_id={response_id}{', starting_after=' + str(cursor) if use_cursor else ''}){RESET}\n",
                flush=True,
            )
            stream_mgr = client.responses.stream(
                response_id=response_id,
                starting_after=start_after,
                extra_headers=TRACE_HEADERS,
            )
        else:
            print(f"\n{DIM}  stream(input=..., background=True){RESET}\n", flush=True)
            stream_mgr = client.responses.stream(
                input=[{"role": "user", "content": prompt}],
                model="agent",  # SDK requires it when creating; server ignores, agent identified by URL
                background=True,
                extra_headers=TRACE_HEADERS,
            )

        with stream_mgr as stream:
            tool_call_state: dict[str, str] = {}
            for event in stream:
                seq = _get_event_attr(event, "sequence_number")
                if seq is not None and use_cursor:
                    cursor = seq

                if response_id is None:
                    resp = _get_event_attr(event, "response")
                    if resp is not None:
                        response_id = _get_event_attr(resp, "id")
                    if response_id:
                        print(f"{DIM}Response ID: {response_id}{RESET}\n", end="", flush=True)

                tid = _get_event_attr(event, "trace_id")
                if tid is not None:
                    trace_id = tid
                if raw_events:
                    d = _to_serializable(event)
                    print(json.dumps(d, indent=2))
                else:
                    text = _process_event(event, tool_call_state)
                    if text:
                        sys.stdout.write(text)
                        sys.stdout.flush()

    stream_with_reconnect()
    _print_stream_footer(response_id, trace_id=trace_id)


# ---------------------------------------------------------------------------
# Example 2: Stream + Retrieve (dispatches to create/retrieve or stream API)
# ---------------------------------------------------------------------------
def example_stream(
    prompt: str,
    use_cursor: bool = True,
    use_stream_api: bool = False,
    max_retries: int = 5,
    max_retry_seconds: int = 600,
    raw_events: bool = False,
) -> None:
    """
    Stream from POST; when connection drops, tenacity retries and we resume.
    With use_stream_api, use client.responses.stream() for both create and resume.
    Otherwise use create(stream=True) + retrieve(stream=True).
    With use_cursor, pass starting_after to avoid duplicates.
    """
    api_label = "stream()" if use_stream_api else "create+retrieve"
    print("=== Example 2: Stream + Retrieve ===\n")
    client = get_client()
    print(f"API: {api_label}")
    print("POST with background=true, stream=true...")
    if prompt == PROMPT_LONG_RUNNING:
        print("(Long prompt — connection may drop; will auto-resume)\n")
    if not use_cursor:
        print("(No cursor — on resume, streams all content again from start; no deduplication)\n")
    if raw_events:
        print("(Raw events mode — printing JSON for each SSE event)\n")

    _print_stream_header()

    if use_stream_api:
        _run_stream_api(client, prompt, use_cursor, max_retries, max_retry_seconds, raw_events)
    else:
        _run_stream_create_retrieve(client, prompt, use_cursor, max_retries, max_retry_seconds, raw_events)


# ---------------------------------------------------------------------------
# CLI and main
# ---------------------------------------------------------------------------
def parse_args() -> argparse.Namespace:
    examples = ("poll", "stream")
    parser = argparse.ArgumentParser(
        description="Demo script for DatabricksOpenAI + Responses API (background, poll, stream with reconnect)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  uv run python scripts/demo_long_running_agent.py poll
  uv run python scripts/demo_long_running_agent.py stream
  uv run python scripts/demo_long_running_agent.py stream --stream-api
  uv run python scripts/demo_long_running_agent.py -e stream --url https://my-app.databricksapps.com
  uv run python scripts/demo_long_running_agent.py --example poll --profile ps
        """,
    )
    parser.add_argument(
        "example",
        nargs="?",
        default="stream",
        choices=examples,
        metavar="EXAMPLE",
        help="Demo to run (default: stream)",
    )
    parser.add_argument(
        "-e",
        "--example",
        dest="example_override",
        choices=examples,
        help="Demo to run (overrides positional)",
    )
    parser.add_argument(
        "--url",
        default="http://localhost:8000",
        help="Agent server URL (default: http://localhost:8000)",
    )
    parser.add_argument(
        "-p",
        "--profile",
        default=None,
        help="Databricks config profile for OAuth (sets DATABRICKS_CONFIG_PROFILE)",
    )
    parser.add_argument(
        "-l",
        "--long",
        dest="use_long_prompt",
        action="store_true",
        help="Use long prompt (14 iterations). Default: short prompt",
    )
    parser.add_argument(
        "--no-cursor",
        dest="use_cursor",
        action="store_false",
        default=True,
        help="For stream: resume without starting_after (streams all content again from start; no deduplication)",
    )
    parser.add_argument(
        "--stream-api",
        dest="use_stream_api",
        action="store_true",
        help="For stream: use client.responses.stream() instead of create+retrieve",
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=5,
        help="Max reconnect attempts (default: 5)",
    )
    parser.add_argument(
        "--max-retry-sec",
        type=int,
        default=600,
        help="Max seconds since start before giving up (default: 600)",
    )
    parser.add_argument(
        "--raw-events",
        dest="raw_events",
        action="store_true",
        help="Output raw JSON events instead of parsed/formatted output",
    )
    args = parser.parse_args()
    args.example = args.example_override if args.example_override else args.example
    if args.profile is not None:
        os.environ["DATABRICKS_CONFIG_PROFILE"] = args.profile
    return args


def main() -> None:
    args = parse_args()

    global AGENT_APP_URL
    AGENT_APP_URL = args.url

    if args.use_long_prompt:
        prompt = PROMPT_LONG_RUNNING
    else:
        prompt = PROMPT_STANDARD
    target = "local" if ("localhost" in AGENT_APP_URL or "127.0.0.1" in AGENT_APP_URL) else "Databricks"
    print(f"Target: {target} ({AGENT_APP_URL})")
    print(f"Demo: {args.example}\n")

    if args.example == "stream":
        example_stream(
            prompt=prompt,
            use_cursor=args.use_cursor,
            use_stream_api=args.use_stream_api,
            max_retries=args.max_retries,
            max_retry_seconds=args.max_retry_sec,
            raw_events=args.raw_events,
        )
    else:
        example_poll(prompt, raw_events=args.raw_events)


if __name__ == "__main__":
    main()
