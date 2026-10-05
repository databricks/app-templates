import type { LiHTMLAttributes } from 'react';
import type { Root } from 'hast';
import type { Components, Options } from 'react-markdown';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import type { AppMarkdownBlock } from '../../shared/appManifest';

const remarkPlugins = [remarkGfm];

// The publisher's Lexical editor emits rich markdown with embedded HTML (blank line as `<p>&nbsp;</p>`,
// font color as `<span style>`, images as data URIs). rehype-raw renders it; rehype-sanitize (which MUST
// follow rehype-raw) is the XSS gate, tightened to just the editor's output. This mirrors the authoring
// preview's sanitizer in universe (appMarkdownSanitize.ts) so the app renders what the author saw.
const IMAGE_MIME_SUFFIXES = ['png', 'jpeg', 'jpg', 'gif', 'webp', 'svg\\+xml'].join('|');
const IMG_SRC_REGEX = new RegExp(
  `^(https://[^\\s]+|data:image/(${IMAGE_MIME_SUFFIXES});base64,[A-Za-z0-9+/=\\s]+)$`,
);

const ALLOWED_SPAN_STYLE_PROPERTIES = new Set([
  'color',
  'background-color',
  'text-decoration',
  'text-decoration-line',
  'font-weight',
  'font-style',
  'text-align',
  'display',
  'line-height',
]);

const sanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), 'data'],
  },
  attributes: {
    ...defaultSchema.attributes,
    span: [['style']],
    a: ['href', ['target', /^(?:_self|_blank)$/]],
    img: ['alt', ['src', IMG_SRC_REGEX]],
    ol: [...(defaultSchema.attributes?.ol ?? []), 'start', 'reversed'],
    // Preserve remark-gfm's task-list class hooks (only those two values) so checkbox lists keep styling.
    ul: [...(defaultSchema.attributes?.ul ?? []), ['className', 'contains-task-list']],
    li: [...(defaultSchema.attributes?.li ?? []), 'value', ['className', 'task-list-item']],
  },
};

function filterSpanStyle(style: string): string {
  return style
    .split(';')
    .map((declaration) => {
      const separator = declaration.indexOf(':');
      if (separator === -1) {
        return undefined;
      }
      const property = declaration.slice(0, separator).trim().toLowerCase();
      const value = declaration.slice(separator + 1).trim();
      if (property === '' || value === '' || !ALLOWED_SPAN_STYLE_PROPERTIES.has(property)) {
        return undefined;
      }
      return `${property}:${value}`;
    })
    .filter((declaration): declaration is string => declaration !== undefined)
    .join(';');
}

// Filters each sanitizer-allowed `<span style>` down to the approved properties. Runs after sanitize.
function sanitizeStyles(): (tree: Root) => void {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName === 'span' && typeof node.properties.style === 'string') {
        node.properties.style = filterSpanStyle(node.properties.style);
      }
    });
  };
}

// Annotated so the inner [rehypeSanitize, sanitizeSchema] is a [plugin, options] tuple, not an array
// of a union; without this react-markdown v10 rejects it as an invalid Pluggable at build time.
const rehypePlugins: NonNullable<Options['rehypePlugins']> = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
  sanitizeStyles,
];

// react-markdown drops non-allowlisted URL protocols (incl. data:) before render; keep an approved
// image source so embedded images survive, and defer to the default transform for every other URL.
function transformUrl(url: string, key: string, node: { tagName?: string }): string {
  if (key === 'src' && node.tagName === 'img' && IMG_SRC_REGEX.test(url)) {
    return url;
  }
  return defaultUrlTransform(url);
}

function MarkdownCode({ children, className }: { children?: React.ReactNode; className?: string }) {
  const language = /language-(\w+)/.exec(className ?? '')?.[1];
  return (
    <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.875em]" data-language={language}>
      {String(children).replace(/\n$/, '')}
    </code>
  );
}

function MarkdownListItem({ children, className, ...props }: LiHTMLAttributes<HTMLLIElement>) {
  const isTaskListItem = className?.includes('task-list-item') ?? false;
  return (
    <li
      {...props}
      className={
        isTaskListItem
          ? `${className ?? ''} flex list-none items-start gap-2`
          : `${className ?? ''} marker:text-muted-foreground`
      }
    >
      {children}
    </li>
  );
}

const markdownComponents: Components = {
  a: ({ href, children }) =>
    href?.startsWith('.') ? (
      <span className="text-muted-foreground">{children}</span>
    ) : (
      <a className="text-primary underline underline-offset-2" href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ),
  code: MarkdownCode,
  pre: ({ children }) => <pre className="bg-muted my-3 overflow-x-auto rounded-md p-4">{children}</pre>,
  p: ({ children }) => <p className="my-3 leading-6 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mt-6 mb-3 text-2xl font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-6 mb-3 text-xl font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-5 mb-2 text-lg font-semibold first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-4 mb-2 text-base font-semibold first:mt-0">{children}</h4>,
  h5: ({ children }) => <h5 className="mt-4 mb-2 text-sm font-semibold first:mt-0">{children}</h5>,
  // appkit-ui's Tailwind base resets list-style, so restore markers + indent explicitly (a task list
  // keeps no marker; its items already carry list-none).
  ul: ({ children, className }) => (
    <ul className={`my-3 pl-6 ${className?.includes('contains-task-list') ? 'list-none' : 'list-disc'}`}>{children}</ul>
  ),
  ol: ({ children, start, reversed }) => (
    <ol className="my-3 list-decimal pl-6" start={start} reversed={reversed}>
      {children}
    </ol>
  ),
  li: MarkdownListItem,
  input: ({ checked }) => (
    <input
      className="border-border mt-1 size-4 shrink-0 accent-current"
      type="checkbox"
      checked={checked}
      disabled
      readOnly
      aria-label={checked ? 'Completed task' : 'Incomplete task'}
    />
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="border-border w-full border-collapse border text-left text-sm">{children}</table>
    </div>
  ),
  tr: ({ children }) => <tr className="border-border border-b last:border-b-0">{children}</tr>,
  th: ({ children }) => <th className="bg-muted border-border border-r px-3 py-2 font-medium last:border-r-0">{children}</th>,
  td: ({ children }) => <td className="border-border border-r px-3 py-2 align-top last:border-r-0">{children}</td>,
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  img: ({ src, alt }) => <img className="max-w-full" src={src} alt={alt} />,
};

export interface MarkdownBlockProps {
  block: AppMarkdownBlock;
}

export function MarkdownBlock({ block }: MarkdownBlockProps) {
  return (
    <section className="border-border border-t px-6 py-5">
      <ReactMarkdown
        components={markdownComponents}
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        urlTransform={transformUrl}
      >
        {block.text}
      </ReactMarkdown>
    </section>
  );
}
