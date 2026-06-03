# sync-agent-skills

Syncs the agent-template skills in this repo (`.claude/skills/`) to the public
[databricks-agent-skills](https://github.com/databricks/databricks-agent-skills)
repo as `skills/databricks-agent-*`. This repo is the source of truth; the sync
is one-way and manual.

## Usage

From the app-templates repo, run Claude Code and say:

```
Run ./sync-agent-skills
```

It reads [`sync-config.yml`](./sync-config.yml), mirrors each skill into a local
databricks-agent-skills checkout — renamed into that repo's `databricks-<topic>`
convention, with template placeholders rendered and cross-links injected for
skills that overlap an existing one — regenerates the downstream `manifest.json`,
and opens a pull request there (via your own browser session) for a maintainer to
review and merge.

See [`sync-agent-skills.md`](./sync-agent-skills.md) for the full runbook.

## Adding a new skill to the sync

Add a `{ source, target }` entry to `sync-config.yml` (`source` = its dir under
`.claude/skills/`; `target` = its `databricks-agent-*` name). If it overlaps an
existing databricks-agent-skills skill, add a `related` cross-link so the mirror
defers to the canonical skill instead of duplicating it.
