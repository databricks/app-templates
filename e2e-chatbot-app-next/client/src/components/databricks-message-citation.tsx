import type { ChatMessage } from '@chat-template/core';
import type {
  AnchorHTMLAttributes,
  ComponentType,
  PropsWithChildren,
} from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * ReactMarkdown/Streamdown component that handles Databricks message citations.
 *
 * @example
 * <Streamdown components={{ a: DatabricksMessageCitationStreamdownIntegration }} />
 */
export const DatabricksMessageCitationStreamdownIntegration: ComponentType<
  AnchorHTMLAttributes<HTMLAnchorElement>
> = (props) => {
  if (isDatabricksMessageCitationLink(props.href)) {
    return (
      <DatabricksMessageCitationRenderer
        {...props}
        href={sanitizeHref(decodeDatabricksMessageCitationLink(props.href))}
      />
    );
  }
  return <DefaultAnchor {...props} />;
};

// const isFootnoteLink

type SourcePart = Extract<ChatMessage['parts'][number], { type: 'source-url' }>;

// Adds a unique suffix to the link to indicate that it is a Databricks message citation.
const encodeDatabricksMessageCitationLink = (part: SourcePart) =>
  `${part.url}::databricks_citation`;

// Removes the unique suffix from the link to get the original link.
const decodeDatabricksMessageCitationLink = (link: string) =>
  link.replace('::databricks_citation', '');

// Creates a markdown link to the Databricks message citation.
export const createDatabricksMessageCitationMarkdown = (part: SourcePart) =>
  `[${part.title || part.url}](${encodeDatabricksMessageCitationLink(part)})`;

// Checks if the link is a Databricks message citation.
const isDatabricksMessageCitationLink = (
  link?: string,
): link is `${string}::databricks_citation` =>
  link?.endsWith('::databricks_citation') ?? false;

// Link schemes that are safe to render; blocks script-capable schemes such as
// `javascript:`, `data:` and `vbscript:` coming from model output.
const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

// Returns the href if it is relative or uses a safe scheme, otherwise undefined.
const sanitizeHref = (href?: string): string | undefined => {
  if (!href || href === 'streamdown:incomplete-link') return href;
  try {
    const { protocol } = new URL(href, window.location.href);
    return SAFE_LINK_PROTOCOLS.has(protocol) ? href : undefined;
  } catch {
    return undefined;
  }
};

// Renders the Databricks message citation.
const DatabricksMessageCitationRenderer = (
  props: PropsWithChildren<{
    href?: string;
  }>,
) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DefaultAnchor
          href={sanitizeHref(props.href)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md bg-muted-foreground px-2 py-0 text-zinc-200"
        >
          {props.children}
        </DefaultAnchor>
      </TooltipTrigger>
      <TooltipContent
        style={{ maxWidth: '300px', padding: '8px', wordWrap: 'break-word' }}
      >
        {props.href}
      </TooltipContent>
    </Tooltip>
  );
};

// Copied from streamdown
// https://github.com/vercel/streamdown/blob/dc5bd12e5709afce09814e47cf80884f8c665b3d/packages/streamdown/lib/components.tsx#L157-L181
const DefaultAnchor: ComponentType<AnchorHTMLAttributes<HTMLAnchorElement>> = (
  props,
) => {
  const isIncomplete = props.href === 'streamdown:incomplete-link';
  const isFootnoteLink = props.href?.startsWith('#');

  return (
    <a
      className={cn(
        'wrap-anywhere font-medium text-primary underline',
        props.className,
      )}
      data-incomplete={isIncomplete}
      data-streamdown="link"
      {...props}
      href={sanitizeHref(props.href)}
      {...(isFootnoteLink
        ? {
            target: '_self',
          }
        : {
            target: '_blank',
            rel: 'noopener noreferrer',
          })}
    >
      {props.children}
    </a>
  );
};
