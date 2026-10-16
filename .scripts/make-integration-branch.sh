#!/usr/bin/env bash
# Build an ephemeral integration branch merging the in-flight validation branches
# ON TOP OF the current branch (which carries the validation tooling).
# Fails loudly on the first conflict so it can be resolved before validating.
set -euo pipefail

# The 6 in-flight PRs. great-feynman-snda6q is intentionally excluded: it is
# semgrep parts 1-4 combined (same 100 files, nothing unique), so it is
# redundant with semgrep-1..4 and would double-count.
BRANCHES=(
  claude/semgrep-1-agent-templates
  claude/semgrep-2-python-apps
  claude/semgrep-3-js-code
  claude/semgrep-4-npm-pins
  claude/semgrep-5-vite8
  claude/semgrep-6-ci
)
INT_BRANCH="integration/validate-$(date +%Y%m%d)"

git fetch origin "${BRANCHES[@]}"
# Base on the CURRENT HEAD (tooling branch), not origin/main (Ruling 2).
git checkout -B "$INT_BRANCH" HEAD
for b in "${BRANCHES[@]}"; do
  echo "==> merging origin/$b"
  if ! git merge --no-edit "origin/$b"; then
    echo "CONFLICT merging origin/$b — resolve, commit, then re-run or continue manually." >&2
    git merge --abort
    exit 1
  fi
done
echo "Integration branch ready: $INT_BRANCH (base: tooling branch HEAD + 6 merged branches)"
