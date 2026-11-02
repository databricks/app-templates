import type { MarkdownTextPrimitiveProps, SyntaxHighlighterProps } from "@assistant-ui/react-markdown";
import { type ComponentType, type FC, lazy, Suspense } from "react";

function lazyNamed<Props>(load: () => Promise<ComponentType<Props>>): ComponentType<Props> {
  return lazy(() => load().then((component) => ({ default: component })));
}

const Prism = lazyNamed(() => import("@/components/assistant-ui/elements/syntax-highlighter").then((module) => module.SyntaxHighlighter));
const Mermaid = lazyNamed(() => import("@/components/assistant-ui/elements/mermaid-diagram.aui").then((module) => module.MermaidDiagram));
const LazyInlineTex = lazyNamed(() => import("./tex").then((module) => module.InlineTex));
const DisplayTex = lazyNamed(() => import("./tex").then((module) => module.DisplayTex));

const PlainCode: FC<SyntaxHighlighterProps> = ({ components: { Pre, Code }, code }) => (
  <Pre>
    <Code>{code}</Code>
  </Pre>
);

function loaded(Component: ComponentType<SyntaxHighlighterProps>): FC<SyntaxHighlighterProps> {
  return (props) => (
    <Suspense fallback={<PlainCode {...props} />}>
      <Component {...props} />
    </Suspense>
  );
}

export const InlineTex: FC<{ tex: string }> = ({ tex }) => (
  <Suspense fallback={<code>{tex}</code>}>
    <LazyInlineTex tex={tex} />
  </Suspense>
);

// Strip `style`, `classDef`, `linkStyle` to prevent loading URLs via SVG paint attributes.
const STYLE_LINES = /^\s*(style|classDef|linkStyle)\b.*$/gm;

const MermaidFence = loaded((props) => <Mermaid {...props} code={props.code.replace(STYLE_LINES, "")} />);

const NO_HEADER = () => null;

export const SyntaxHighlighter = loaded(Prism);

// Renderers by language, lazy-loaded. `math` is display math ($$...$$).
export const FENCES: NonNullable<MarkdownTextPrimitiveProps["componentsByLanguage"]> = {
  math: { SyntaxHighlighter: loaded(({ code }) => <DisplayTex tex={code} />), CodeHeader: NO_HEADER },
  mermaid: { SyntaxHighlighter: MermaidFence },
};
