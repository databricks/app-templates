import type { ChatMessage } from '@/lib/types';
import type {
  AnchorHTMLAttributes,
  ComponentType,
  PropsWithChildren,
} from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { components } from './elements/streamdown-components/components';

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
        href={decodeDatabricksMessageCitationLink(props.href)}
      />
    );
  }
  return <components.a {...props} />;
};

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

// Renders the Databricks message citation.
const DatabricksMessageCitationRenderer = (
  props: PropsWithChildren<{
    href: string;
  }>,
) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <components.a
          href={props.href}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md bg-muted-foreground px-2 py-0 text-zinc-200"
        >
          {props.children}
        </components.a>
      </TooltipTrigger>
      <TooltipContent
        style={{ maxWidth: '300px', padding: '8px', wordWrap: 'break-word' }}
      >
        {props.href}
      </TooltipContent>
    </Tooltip>
  );
};
