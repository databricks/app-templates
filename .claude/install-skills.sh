#!/usr/bin/env bash
# Install Databricks Claude Code skills from the app-templates repo.
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/databricks/app-templates/main/.claude/install-skills.sh | bash -s -- <skills...>
#
# Examples:
#   bash install-skills.sh --list
#   bash install-skills.sh quickstart deploy run-locally
#   bash install-skills.sh --global --all

set -euo pipefail

REPO_URL="https://github.com/databricks/app-templates.git"
BRANCH="main"
SKILLS_PATH=".claude/skills"

# All available skills (must stay in sync with .claude/skills/)
ALL_SKILLS=(
  add-tools-langgraph
  add-tools-openai
  agent-langgraph-memory
  agent-openai-memory
  deploy
  discover-tools
  lakebase-setup
  migrate-from-model-serving
  modify-langgraph-agent
  modify-openai-agent
  quickstart
  run-locally
)

# Colors (disabled when stdout is not a terminal)
if [[ -t 1 ]]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  BLUE='\033[0;34m'
  BOLD='\033[1m'
  NC='\033[0m'
else
  RED='' GREEN='' YELLOW='' BLUE='' BOLD='' NC=''
fi

info()    { printf "${BLUE}==>${NC} ${BOLD}%s${NC}\n" "$*"; }
warn()    { printf "${YELLOW}warning:${NC} %s\n" "$*" >&2; }
error()   { printf "${RED}error:${NC} %s\n" "$*" >&2; }
success() { printf "${GREEN}==>${NC} ${BOLD}%s${NC}\n" "$*"; }

usage() {
  cat <<'EOF'
Usage: install-skills.sh [OPTIONS] [SKILL...]

Install Databricks Claude Code skills into your project.

Options:
  --global    Install to ~/.claude/skills/ instead of ./.claude/skills/
  --list      List all available skills and exit
  --all       Install all available skills
  -h, --help  Show this help message

Examples:
  # Install specific skills into current project
  install-skills.sh quickstart deploy run-locally

  # Install all skills globally
  install-skills.sh --global --all

  # One-liner from GitHub
  curl -sSL https://raw.githubusercontent.com/databricks/app-templates/main/.claude/install-skills.sh \
    | bash -s -- quickstart deploy

  # List available skills
  install-skills.sh --list
EOF
}

# --- Parse arguments ---

INSTALL_GLOBAL=false
LIST_ONLY=false
INSTALL_ALL=false
REQUESTED_SKILLS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --global)  INSTALL_GLOBAL=true; shift ;;
    --list)    LIST_ONLY=true; shift ;;
    --all)     INSTALL_ALL=true; shift ;;
    -h|--help) usage; exit 0 ;;
    -*)        error "Unknown option: $1"; usage; exit 1 ;;
    *)         REQUESTED_SKILLS+=("$1"); shift ;;
  esac
done

# --- Handle --list (no network needed) ---

if [[ "$LIST_ONLY" == true ]]; then
  printf "${BOLD}Available skills:${NC}\n\n"
  for skill in "${ALL_SKILLS[@]}"; do
    printf "  %s\n" "$skill"
  done
  printf "\nInstall with: ${BOLD}install-skills.sh <skill-name> [...]${NC}\n"
  exit 0
fi

# --- Determine skills to install ---

if [[ "$INSTALL_ALL" == true ]]; then
  if [[ ${#REQUESTED_SKILLS[@]} -gt 0 ]]; then
    error "--all cannot be combined with specific skill names"
    exit 1
  fi
  SKILLS_TO_INSTALL=("${ALL_SKILLS[@]}")
elif [[ ${#REQUESTED_SKILLS[@]} -gt 0 ]]; then
  SKILLS_TO_INSTALL=("${REQUESTED_SKILLS[@]}")
else
  error "No skills specified. Use --all for all skills, or provide skill names."
  printf "\n"
  usage
  exit 1
fi

# --- Validate skill names before doing any work ---

INVALID_SKILLS=()
for skill in "${SKILLS_TO_INSTALL[@]}"; do
  found=false
  for valid in "${ALL_SKILLS[@]}"; do
    if [[ "$skill" == "$valid" ]]; then
      found=true
      break
    fi
  done
  if [[ "$found" == false ]]; then
    INVALID_SKILLS+=("$skill")
  fi
done

if [[ ${#INVALID_SKILLS[@]} -gt 0 ]]; then
  error "Unknown skill(s): ${INVALID_SKILLS[*]}"
  printf "\nAvailable skills:\n"
  for skill in "${ALL_SKILLS[@]}"; do
    printf "  %s\n" "$skill"
  done
  exit 1
fi

# --- Check dependencies ---

if ! command -v git &>/dev/null; then
  error "git is required but not found in PATH"
  exit 1
fi

# --- Set target directory ---

if [[ "$INSTALL_GLOBAL" == true ]]; then
  TARGET_DIR="$HOME/.claude/skills"
else
  TARGET_DIR="./.claude/skills"
fi

# --- Download via git sparse checkout ---

TMPDIR_BASE="${TMPDIR:-/tmp}"
WORK_DIR=$(mktemp -d "${TMPDIR_BASE%/}/install-skills.XXXXXX")
trap 'rm -rf "$WORK_DIR"' EXIT

info "Downloading skills from databricks/app-templates..."

git clone \
  --depth=1 \
  --filter=blob:none \
  --sparse \
  --branch "$BRANCH" \
  --quiet \
  "$REPO_URL" \
  "$WORK_DIR/repo"

ORIG_DIR="$PWD"
cd "$WORK_DIR/repo"

SPARSE_PATHS=()
for skill in "${SKILLS_TO_INSTALL[@]}"; do
  SPARSE_PATHS+=("${SKILLS_PATH}/${skill}")
done

git sparse-checkout set "${SPARSE_PATHS[@]}" 2>/dev/null

cd "$ORIG_DIR"

# --- Copy skills to target ---

INSTALLED=0

for skill in "${SKILLS_TO_INSTALL[@]}"; do
  SRC="$WORK_DIR/repo/${SKILLS_PATH}/${skill}"

  if [[ ! -d "$SRC" ]]; then
    warn "Skill '${skill}' not found in repository (may have been renamed or removed)"
    continue
  fi

  DEST="${TARGET_DIR}/${skill}"

  if [[ -d "$DEST" ]]; then
    warn "Overwriting existing skill: ${skill}"
    rm -rf "$DEST"
  fi

  mkdir -p "$DEST"
  cp -R "$SRC"/. "$DEST"/
  INSTALLED=$((INSTALLED + 1))
  printf "  ${GREEN}+${NC} %s\n" "$skill"
done

# --- Summary ---

printf "\n"
if [[ $INSTALLED -gt 0 ]]; then
  success "Installed ${INSTALLED} skill(s) to ${TARGET_DIR}"
  if [[ "$INSTALL_GLOBAL" == true ]]; then
    printf "\n  Skills are available globally for all Claude Code projects.\n"
  else
    printf "\n  Skills are available in this project's Claude Code context.\n"
  fi
else
  error "No skills were installed"
  exit 1
fi
