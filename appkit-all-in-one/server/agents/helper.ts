import { createAgent, tool } from '@databricks/appkit/beta';
import { z } from 'zod';

/**
 * Code-defined helper agent: holds the tools. Shipped as a sub-agent of
 * the user-facing `planner` markdown agent (which references it via
 * `agents: [helper]` in its frontmatter) rather than a chat-tab on its
 * own. When the user asks planner for a computational action — "what
 * time is it?", "count the words in this string" — planner calls the
 * `agent-helper` tool, the agents plugin routes the sub-agent
 * invocation here, and the answer flows back into the planner thread.
 *
 * Two reasons to keep this code-defined instead of folding it into the
 * markdown:
 *
 *   1. `tool({...})` calls live in TypeScript so the Zod schema, the
 *      `execute` callback, and the return type all type-check together.
 *      Markdown frontmatter is for prompt-driven specialists; code is
 *      for behaviour-driven workers.
 *   2. The dual-form composition (markdown coordinator + code worker)
 *      is the canonical agents-plugin pattern; this template wires it
 *      end to end so a scaffolded app has a working example to copy.
 *
 * Tools are intentionally dependency-free (no SQL warehouse, no
 * volumes, no external APIs) so the round-trip works on a bare
 * scaffold regardless of which other plugins were selected.
 * With MLflow UC tracing enabled, a delegated tool request demonstrates
 * the semantic AGENT → TOOL → AGENT → TOOL tree in one exported trace.
 */
export const helper = createAgent({
  name: 'helper',
  instructions: [
    'You are a tool-using helper agent.',
    'When the user asks about the time, call `current_time`.',
    'When the user asks to count words in a string, call `count_words`.',
    'For anything else, answer briefly in plain text.',
  ].join(' '),
  tools: {
    current_time: tool({
      description: 'Returns the current server time as an ISO 8601 timestamp.',
      schema: z.object({}),
      annotations: { effect: 'read' },
      execute: () => ({ now: new Date().toISOString() }),
    }),
    count_words: tool({
      description: 'Counts the words in a string. Words are runs of non-whitespace.',
      schema: z.object({
        text: z.string().describe('The text to count words in.'),
      }),
      annotations: { effect: 'read' },
      execute: ({ text }) => ({
        text,
        word_count: text.trim().split(/\s+/).filter(Boolean).length,
      }),
    }),
  },
});
