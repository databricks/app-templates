import { useAuiState } from "@assistant-ui/react";
import { Citation } from "@/components/assistant-ui/elements/inline-citation";
import { MarkdownText } from "@/components/assistant-ui/elements/markdown-text";

/** A marker the model writes after a claim: `(source:<object>)`, the last part of the name of what it read. */
export const SOURCE_MARKER = /\(source:([a-z0-9_]+)\)/g;

const SNIPPET = "Read for this answer. Assistant activity lists every read.";

type Node = { type: string; value?: string; children?: Node[]; data?: Record<string, unknown> };

function marked(text: string): Node[] {
  const nodes: Node[] = [];
  let last = 0;
  for (const match of text.matchAll(SOURCE_MARKER)) {
    if (match.index > last) nodes.push({ type: "text", value: text.slice(last, match.index) });
    nodes.push({ type: "sourceMarker", data: { hName: "cite", hProperties: { dataSource: match[1] } } });
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push({ type: "text", value: text.slice(last) });
  return nodes;
}

function splitMarkers(node: Node): void {
  if (!node.children) return;
  node.children = node.children.flatMap((child) => {
    if (child.type === "text" && child.value) return marked(child.value);
    splitMarkers(child);
    return [child];
  });
}

/** Turns each source marker in the answer's text into a `cite` element that names the object. */
const remarkSourceMarkers = () => splitMarkers;

/**
 * A marker as a numbered citation of the message's source with that name. A
 * marker that names nothing the run read shows nothing.
 */
function SourceMarker(props: { "data-source"?: string }) {
  const name = props["data-source"];
  const index = useAuiState((state) =>
    state.message.content.filter((part) => part.type === "source").findIndex((part) => part.id.endsWith(`.${name}`)),
  );
  const title = useAuiState((state) => {
    const part = state.message.content.filter((item) => item.type === "source")[index];
    return part?.type === "source" ? (part.title ?? "") : "";
  });
  if (index < 0) return null;
  return <Citation index={index} source={{ title, snippet: SNIPPET }} />;
}

const PLUGINS = [remarkSourceMarkers];
const COMPONENTS = { cite: SourceMarker as never };

/** The answer's markdown, with the model's source markers as inline citations. */
export function CitedText() {
  return <MarkdownText remarkPlugins={PLUGINS} components={COMPONENTS} />;
}
