# -*- coding: utf-8 -*-
"""
Validate MLflow tracing setup through static code analysis.

This script checks that tracing is properly integrated without requiring
authentication or actually running the agent.

The coding agent should discover tracing integration first using Grep, then pass
the discovered information to this script for validation.

Checks:
- Autolog call present and correctly ordered
- @mlflow.trace decorators on entry points
- MLflow imports present
- Session ID capture code (optional)

Usage:
    # After discovering with grep:
    python scripts/validate_tracing_static.py \
        --autolog-file src/agent/__init__.py \
        --decorated-functions "run_agent:src/agent/main.py" \
        --decorated-functions "process_query:src/agent/handler.py"
"""

import argparse
import sys
from pathlib import Path

from utils import check_import_order, check_session_id_capture, verify_mlflow_imports


def parse_arguments():
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Validate MLflow tracing integration (static analysis)"
    )
    parser.add_argument(
        "--autolog-file",
        help="Path to file containing autolog() call (e.g., src/agent/__init__.py)",
    )
    parser.add_argument(
        "--decorated-functions",
        action="append",
        help='Decorated function in format \'function_name:file_path\'. '
             'Repeat flag for multiple functions. '
             'Example: --decorated-functions "run_agent:src/agent.py" --decorated-functions "process:src/handler.py"',
    )
    parser.add_argument(
        "--check-session-tracking",
        action="store_true",
        help="Check for session ID tracking code",
    )
    return parser.parse_args()


def main():
    """Main validation workflow."""
    args = parse_arguments()

    print("=" * 60)
    print("Static Tracing Validation")
    print("=" * 60)
    print()

    issues = []

    # Check 1: Autolog validation
    print("Checking autolog configuration...")
    if not args.autolog_file:
        print("  ⚠ No autolog file specified")
        print("  Use --autolog-file to specify the file containing autolog() call")
        print("\n  To find autolog calls:")
        print("    grep -r 'mlflow.*autolog' . --include='*.py'")
        print()
    else:
        autolog_path = Path(args.autolog_file)
        if not autolog_path.exists():
            print(f"  ✗ File not found: {args.autolog_file}")
            issues.append(f"Autolog file not found: {args.autolog_file}")
        else:
            print(f"  ✓ Autolog file: {args.autolog_file}")

            # Check import order
            is_correct, message = check_import_order(str(autolog_path))
            if is_correct:
                print(f"  ✓ {message}")
            else:
                print(f"  ✗ {message}")
                print("    Move autolog call before library/agent imports")
                issues.append(f"Import order incorrect in {args.autolog_file}")

    # Check 2: Trace decorators validation
    print("\nChecking @mlflow.trace decorators...")
    if not args.decorated_functions:
        print("  ⚠ No decorated functions specified")
        print("  Use --decorated-functions to specify functions with @mlflow.trace")
        print("\n  To find decorated functions:")
        print("    grep -r '@mlflow.trace' . --include='*.py'")
        print()
    else:
        decorated_files = set()
        for entry in args.decorated_functions:
            if ":" not in entry:
                print(f"  ✗ Invalid format: {entry}")
                print("    Expected format: 'function_name:file_path'")
                issues.append(f"Invalid decorated function format: {entry}")
                continue

            func_name, file_path = entry.split(":", 1)
            file_path = file_path.strip()
            func_name = func_name.strip()

            if not Path(file_path).exists():
                print(f"  ✗ File not found: {file_path}")
                issues.append(f"Decorated function file not found: {file_path}")
            else:
                print(f"  ✓ {func_name} in {file_path}")
                decorated_files.add(file_path)

        # Check 3: Verify mlflow imports
        if decorated_files:
            print("\nChecking mlflow imports...")
            import_results = verify_mlflow_imports(list(decorated_files))

            for file_path, has_import in import_results.items():
                if has_import:
                    print(f"  ✓ mlflow imported in {file_path}")
                else:
                    print(f"  ✗ mlflow NOT imported in {file_path}")
                    print("    Add: import mlflow")
                    issues.append(f"mlflow not imported in {file_path}")

    # Check 4: Session tracking (optional)
    if args.check_session_tracking:
        print("\nChecking session ID tracking...")
        if not args.decorated_functions:
            print("  ⚠ Cannot check without decorated functions specified")
        else:
            found_session_tracking = False
            for entry in args.decorated_functions:
                if ":" in entry:
                    _, file_path = entry.split(":", 1)
                    if check_session_id_capture(file_path.strip()):
                        print(f"  ✓ Session tracking found in {file_path.strip()}")
                        found_session_tracking = True
                        break

            if not found_session_tracking:
                print("  ⚠ No session tracking found")
                print("    For multi-turn agents, add session ID tracking:")
                print("      trace_id = mlflow.get_last_active_trace_id()")
                print("      mlflow.set_trace_tag(trace_id, 'session_id', session_id)")

    # Summary
    print("\n" + "=" * 60)
    if issues:
        print(f"✗ Validation failed with {len(issues)} issue(s):")
        for issue in issues:
            print(f"  - {issue}")
        print("=" * 60)
        sys.exit(1)
    else:
        print("✓ Static validation passed!")
        print("=" * 60)
        sys.exit(0)


if __name__ == "__main__":
    main()