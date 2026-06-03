# sync-agent-skills

Syncs the agent-template skills in this repo (`.claude/skills/`) to the public
[databricks-agent-skills](https://github.com/databricks/databricks-agent-skills)
repo as a single `databricks-agent-templates` skill — a router `SKILL.md` plus
one `references/<source>/` per source skill, matching that repo's
one-skill-per-area layout. This repo is the source of truth; the sync is one-way
and manual.

## Usage

From the app-templates repo, run Claude Code and say:

```
Run ./sync-agent-skills
```

It reads [`sync-config.yml`](./sync-config.yml), assembles the source skills into
the single `databricks-agent-templates` skill in a local databricks-agent-skills
checkout — placeholders rendered, cross-links injected for topics that overlap an
existing skill — regenerates the downstream `manifest.json`, and opens a pull
request there (via your own browser session) for a maintainer to review and merge.

See [`sync-agent-skills.md`](./sync-agent-skills.md) for the full runbook.

## Adding a new skill to the sync

Add a `references` entry to `sync-config.yml` (`source` = its dir under
`.claude/skills/`; `group` + `summary` place it in the router index). If it
overlaps an existing databricks-agent-skills skill, add a `related` cross-link so
the reference defers to the canonical skill instead of duplicating it.
