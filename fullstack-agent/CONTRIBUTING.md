# Contributing

## Before you change code

- Read [AGENTS.md](AGENTS.md). It holds the repo's rules.
- Set up the tools as [docs/development.md](docs/development.md#before-you-start) describes, then run `make install`.
- Keep use-case code, text and data in the use-case files that [docs/customization.md](docs/customization.md) lists. Every other file holds no use-case words, so teams that adapt the repo can merge its release tags.

## Checks

| Command | What it runs |
| :-- | :-- |
| `make check` | The pre-commit hooks: ruff lint (with type hints) and format, shellcheck, YAML, whitespace, large files, private keys, public package hosts in the shipped lockfiles, and `app/requirements.txt` against `uv.lock`. |
| `make test` | The app and eval unit tests, then the UI tests against fixtures in Chromium and WebKit. |
| `make build` | Builds `frontend/src` into `app/static/`. |

A change to SQL, procedures, grants or auth also needs the workspace suites in [docs/development.md](docs/development.md#tests). They need a Databricks workspace and the test users.

## Commits and pull requests

- Use Conventional Commits with a scope, such as `fix(agent): ...` or `docs(repo): ...`.
- Edit `frontend/src`, never `app/static/`. After a frontend change, run `make build` and commit the rebuilt `app/static/` on its own, as `build(frontend): rebuild app/static for <change>`.
- Never edit `app/requirements.txt`. The `uv-export` hook writes it from `uv.lock`.
- Once the project is in its own repo, a pull request runs [`.github/workflows/pr.yml`](.github/workflows/pr.yml) ([the jobs](docs/deployment.md#pull-requests)). Its `bundle-validate` job signs in with GitHub OIDC, which a fork's pull request doesn't get, so it skips there.
