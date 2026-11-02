/// <reference types="react-syntax-highlighter" />

import type { SyntaxHighlighterProps } from "@assistant-ui/react-markdown";
import PrismLight from "react-syntax-highlighter/dist/esm/prism-light";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import coldarkCold from "react-syntax-highlighter/dist/esm/styles/prism/coldark-cold";

PrismLight.registerLanguage("bash", bash);
PrismLight.registerLanguage("javascript", javascript);
PrismLight.registerLanguage("json", json);
PrismLight.registerLanguage("python", python);
PrismLight.registerLanguage("sql", sql);
PrismLight.registerLanguage("typescript", typescript);
PrismLight.alias({ bash: ["sh", "shell"], javascript: ["js"], python: ["py"], typescript: ["ts"] });

/** Markdown Pre surface shows through instead of Prism's background. */
const CUSTOM_STYLE = { background: undefined, margin: 0, width: "100%", padding: "1.5rem 1rem" };

/**
 * Prism-highlighted code block. Only registered languages highlighted; others
 * show as plain code, keeping build size small.
 */
export const SyntaxHighlighter = ({ components: { Pre, Code }, language, code }: SyntaxHighlighterProps) => (
  <PrismLight PreTag={Pre} CodeTag={Code} style={coldarkCold} customStyle={CUSTOM_STYLE} language={language}>
    {code}
  </PrismLight>
);
