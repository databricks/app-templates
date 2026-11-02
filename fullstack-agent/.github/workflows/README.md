# CI/CD workflows

These workflows are a template: GitHub runs them only from a repository's root, so copy this project into its own repo to use them. [deployment.md#cicd](../../docs/deployment.md#cicd) describes each job, and [Before CI deploys](../../docs/deployment.md#before-ci-deploys) lists what they need first: the GitHub environments, a deploy service principal for each and its first deploy. Then set the owner in `../CODEOWNERS`.

## Targets

| Target | Who deploys it | When | Data |
| :--- | :--- | :--- | :--- |
| `dev` | You, from your machine | Whenever you choose | None |
| `demo` | You, from your machine; the bundle's default | Whenever you choose | The test data and the demo users' rows |
| `staging` | CI | On every push to `main` | The test data, reset on each deploy |
| `prod` | CI | On a release tag, after a reviewer approves | No test data and no test users |

## Branches and releases

1. Open a pull request into `main`. `pr.yml` checks it, and a newer push cancels the run in progress.
2. Merge it. `deploy.yml` deploys `staging` and tests it there.
3. To release, merge a pull request from a `release/vX.Y.Z` branch whose `staging` run passed. `release_tag.yml` tags the merge commit, publishes a release with generated notes, and runs `deploy.yml` on the tag, which waits for a `prod` reviewer. A `v*` tag pushed by hand also deploys `prod`.

Each target deploys one run at a time, and a deploy is never cancelled. A failed test leaves the new commit in `staging`: fix it with another pull request.

## Other files

- `../dependabot.yml` updates uv, npm and the actions' SHA pins, groups minor and patch updates, and waits 7 days after a release, except for `databricks*` packages. uv and npm resolve from the public registries that `uv.lock` and `frontend/package-lock.json` name.
- `../CODEOWNERS` and `../pull_request_template.md`.
