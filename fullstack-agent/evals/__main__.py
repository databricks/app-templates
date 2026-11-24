"""Run evals against deployed agent and manage judges.
Commands: run --split dev, label, align, schedule. run syncs and gates results."""

import argparse
import sys

from evals.cases import SPLITS
from evals.labeling import align, label
from evals.monitoring import PRODUCTION_SAMPLE_RATE, schedule
from evals.run import run


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m evals", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    run_command = commands.add_parser("run", help="run, gate and log one split")
    run_command.add_argument("--split", choices=SPLITS, required=True)
    run_command.add_argument("--k", type=int, default=3, help="trials per case")
    run_command.add_argument("--max-tokens", type=int, default=300_000)
    run_command.add_argument(
        "--tokens-per-turn",
        type=int,
        default=32_000,
        help="estimate for the cost line printed before the run",
    )
    run_command.add_argument(
        "--categories", nargs="+", help="run only these categories"
    )
    run_command.add_argument(
        "--release", action="store_true", help="mark a passing run as the release"
    )
    run_command.set_defaults(handler=run)
    label_command = commands.add_parser("label", help="label a run for the judges")
    label_command.add_argument("--run-id", required=True)
    label_command.add_argument("--labeler", required=True)
    label_command.set_defaults(handler=label)
    align_command = commands.add_parser("align", help="align judges to labels")
    align_command.add_argument("--session", required=True)
    align_command.set_defaults(handler=align)
    schedule_command = commands.add_parser("schedule", help="score production")
    schedule_command.add_argument(
        "--sample-rate", type=float, default=PRODUCTION_SAMPLE_RATE
    )
    schedule_command.set_defaults(handler=schedule)
    arguments = parser.parse_args()
    sys.exit(arguments.handler(arguments))


if __name__ == "__main__":
    main()
