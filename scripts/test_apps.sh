#!/usr/bin/env bash
set -euo pipefail

GLOBAL_TEST_REQS="test-requirements.txt"

UNTESTED_APPS=(
  dash-data-app-obo-user
  dash-data-app
  dash-hello-world-app
  flask-hello-world-app
  gradio-data-app-obo-user
  gradio-data-app
  gradio-hello-world-app
  shiny-data-app-obo-user
  shiny-data-app
  shiny-hello-world-app
  streamlit-data-app-obo-user
  streamlit-data-app
  streamlit-hello-world-app
  shiny-chatbot-app
  gradio-chatbot-app
  dash-chatbot-app
)

is_untested() {
  for app in "${UNTESTED_APPS[@]}"; do
    [[ "$1" == "$app" ]] && return 0
  done
  return 1
}

echo "🔍 Checking for test coverage..."

missing_tests=()
for dir in */; do
  base=$(basename "$dir")

  if is_untested "$base"; then
    continue
  fi

  if [[ -f "$dir/app.yaml" ]]; then
    test_dir="${base}/tests"
    if [[ ! -d "$test_dir" ]]; then
      missing_tests+=("$base")
    fi
  fi
done

if (( ${#missing_tests[@]} > 0 )); then
  echo "❌ The following apps have app.yaml but no tests:"
  for app in "${missing_tests[@]}"; do
    echo "  - $app"
  done
  echo "Please add tests under tests/<app-name>/ or add to UNTESTED_APPS."
  exit 1
fi

echo "✅ All testable apps have test coverage. Running tests..."

for dir in */; do
  base=$(basename "$dir")

  if is_untested "$base"; then
    echo "🟡 Skipping $base (allowlisted as an untested app)"
    continue
  fi

  if [[ ! -f "$dir/app.yaml" ]]; then
    echo "⚠️ Skipping $base (no app.yaml)"
    continue
  fi

  echo "🔧 Testing $base..."

  VENV_DIR=".venv-${base}"
  python3 -m venv "$VENV_DIR"
  source "$VENV_DIR/bin/activate"

  pip install -U pip
  pip install -r "$GLOBAL_TEST_REQS"
  pip install -r "$dir/requirements.txt"

  test_dir="${base}/tests"
  echo "🧪 Running tests in $test_dir from $dir"
  pytest --cov="$dir" "$test_dir" --rootdir="$dir"

  deactivate
  rm -rf "$VENV_DIR"
done
