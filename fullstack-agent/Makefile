.PHONY: install env dev dev-server dev-frontend check test build deploy reset destroy

target_flag = $(if $(TARGET),-t $(TARGET))

install:
	npm --prefix frontend ci
	npx --prefix frontend playwright install chromium webkit

env:
	scripts/local_env.sh $(TARGET)

dev:
	$(MAKE) -j2 dev-server dev-frontend

dev-server: env
	cd app && uv run uvicorn runtime.main:app --reload --port 8000

dev-frontend:
	APP_DEV_EMAIL="$$(databricks current-user me -o json | jq -r .userName)" npm --prefix frontend run dev

check:
	uv run pre-commit run --files $$(git ls-files)

test:
	uv run --package app pytest -c app/pyproject.toml app/tests evals/tests
	npm --prefix frontend run test:ui

build:
	npm --prefix frontend ci
	npm --prefix frontend run build

deploy:
	scripts/check_bundle_name.sh $(TARGET)
	databricks bundle deploy $(target_flag)
	databricks bundle run $(target_flag) schema
	scripts/deploy_agent.sh $(TARGET)
	scripts/setup_identities.sh $(TARGET)

reset:
	databricks bundle run $(target_flag) reset_data
	scripts/clear_conversations.sh

destroy:
	scripts/destroy.sh $(TARGET)
