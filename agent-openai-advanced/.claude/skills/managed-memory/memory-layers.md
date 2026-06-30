# Memory layers — semantic / episodic / procedural

A companion to the **managed-memory** skill (`SKILL.md`, Step 6). The memory store is flat: it stores
entries at `/memories/...` paths and doesn't know about memory *types*. This file adds a **convention**
that makes the agent distill every memory into one of three kinds before it saves, and store each under a
matching path prefix. Nothing here changes the five tools or the wiring in Steps 3–5 — it only changes the
**system prompt** and the **paths the model chooses**.

Adopt this when the user wants memory organized into layers, or asks for "semantic / episodic / procedural
memory". If they just want durable memory, the flat default in `SKILL.md` Step 5 is enough.

## The three layers

| Layer | Question it answers | Typical content | How it's stored |
|---|---|---|---|
| **Semantic** | *What is true?* | Stable facts & preferences — name, role, stack, "prefers oat milk", "team uses pnpm". Timeless until corrected. | `save_memory` under `/memories/semantic/...` |
| **Procedural** | *How do I do this?* | The user's way of doing a recurring task — ordered steps, rules, checklists, conventions. "When I open a PR, run X then Y." | `save_memory` under `/memories/procedural/...` |
| **Episodic** | *What happened, and when?* | The running history of a conversation, and durable summaries of specific past events ("on 2026-06-12 we decided to cap pricing at $X"). Time-anchored. | **Conversations API** for live turn history (auto); `save_memory` under `/memories/episodic/...` only for a durable *event summary*, never a transcript |

Episodic running history is best left to the **Conversations API** (see `SKILL.md` → *Episodic memory via the
Conversations API*) when the agent uses the Supervisor API, or to the template's short-term session memory
(checkpointer / `AsyncDatabricksSession`) otherwise. Use `save_memory` under `/memories/episodic/...` sparingly
— only for an event the user will want recalled in a *future, unrelated* conversation.

## Decide the layer BEFORE you save

Run this once per candidate memory:

1. **Is it timeless or time-anchored?**
   - Time-anchored (a specific event, decision, or incident with a date/occasion) → **episodic**. Save a one-line
     summary under `/memories/episodic/`, dated. If it's just the current conversation's flow, don't save it —
     that's session/conversation state.
   - Timeless → go to 2.
2. **Is it a fact/preference, or a way of doing something?**
   - A statement about what is true or preferred → **semantic** (`/memories/semantic/`).
   - A repeatable procedure — steps, rules, an order of operations → **procedural** (`/memories/procedural/`).
3. **When in doubt between semantic and procedural:** if you'd act on it by *recalling a fact*, it's semantic;
   if you'd act on it by *following steps*, it's procedural.

## Path conventions

Every path still starts `/memories/` (the API requires it). The **layer is the first segment**, then one
**broad, stable topic** file — put specifics in `description`/`contents`, not the path (same rule as the flat
convention: avoid over-specific paths that mint near-duplicates).

```
/memories/semantic/coding-preferences.md
/memories/semantic/profile.md
/memories/procedural/pr-review-steps.md
/memories/procedural/deploy-checklist.md
/memories/episodic/2026-06-pricing-decision.md
```

- **Good:** `/memories/semantic/coding-preferences.md` holding every coding preference, updated over time.
- **Avoid:** `/memories/semantic/prefers-tabs.md` + `/memories/semantic/prefers-2-space.md` — two near-duplicate
  files that should be one topic you `update_memory`.
- `list_memories` returns the full path, so the prefix doubles as a cheap filter when scanning for recall.

## Drop-in layered `MEMORY_INSTRUCTIONS`

Use this **instead of** the prompt in `SKILL.md` Step 5 (same placement and wiring — pass it as the agent's
`instructions` / `system_prompt`):

```python
MEMORY_INSTRUCTIONS = """You have durable, cross-session memory about whoever (or whatever) this conversation is scoped to. Use it deliberately, not by reflex.

Recall whenever the answer is about the user or calls for personalized information — anything that might draw on facts, preferences, workflows, or past decisions they've shared before — and you don't already have it from this conversation; also list once before saving, to find the right existing topic. Don't tell the user you don't know their preferences without checking — list_memories first. Memory paths are organized by layer (/memories/semantic/, /memories/procedural/, /memories/episodic/), so the prefix tells you what kind of memory each entry is; scan the list and open the relevant one(s). Skip memory only when the answer truly doesn't depend on who's asking (general knowledge, math) or you already have what you need. A `[has_contents]` entry has a body to get_memory; one without is fully captured by its description. Open a memory with get_memory before you state its specifics, and never assert a fact that isn't stored. Don't re-list what you've already seen this turn.

Save only what will still matter in a future, unrelated conversation — something the user actually stated or decided, not your own suggestions or guesses, passing chatter, secrets, or anything scoped to this chat. Before each save, classify the memory into ONE layer and use the matching path prefix:
- SEMANTIC — a stable fact or preference (what is true): /memories/semantic/<topic>.md
- PROCEDURAL — how the user wants a recurring task done, as steps or rules: /memories/procedural/<topic>.md
- EPISODIC — a durable summary of a specific past event or decision (what happened, when), dated: /memories/episodic/<topic>.md. Do NOT save the running conversation here — that's handled automatically; reserve this for an event worth recalling later.
When unsure between semantic and procedural: if you'd act on it by recalling a fact it's semantic; if you'd act on it by following steps it's procedural.
- Write each memory so it stands on its own out of context, under one broad, stable topic per subject within its layer, with the specifics inside it.
- Check the list first and update_memory an existing topic instead of minting a near-duplicate. Don't store the same thing in two layers.
- For a very broad question that touches many memories, summarize from the list's descriptions; reserve get_memory for the specific entry you actually need.
- If the user's info changes or contradicts what's stored, update or replace it rather than keeping both — but don't rewrite a memory that already says the same thing.
- delete_memory what's stale.
- Briefly tell the user whenever you save, update, or delete, and which layer it went to."""
```

## Notes

- **No new tools or grants.** Layering is purely the prompt above + the path prefixes the model picks. The five
  tools, scope handling, and permissions from `SKILL.md` are unchanged.
- **Episodic vs. the Conversations API.** Keep them distinct: the Conversations API (or the short-term
  checkpointer/session) carries the live turn history; `/memories/episodic/...` holds only hand-picked durable
  event summaries. Don't dump transcripts into the store.
- **Migration.** If a scope already has flat `/memories/...` entries, you don't have to move them — new saves
  follow the layered convention, and you can re-home an old entry by `save_memory` to the new path + `delete_memory`
  the old one when you next touch it.
