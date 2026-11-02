"""The agent's prompts, one Markdown file each, read by the agent and the evals."""

from pathlib import Path

PROMPTS_DIR = Path(__file__).parent


def prompt(name: str) -> str:
    """The text of the prompt file `<name>.md`, without its final newline."""
    return (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8").rstrip("\n")
