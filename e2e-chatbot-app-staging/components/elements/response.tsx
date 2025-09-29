'use client';

import { cn } from '@/lib/utils';
import { type ComponentProps, memo } from 'react';
import { DatabricksMessageCitationStreamdownIntegration } from '../databricks-message-citation';
import {
  ShikiThemeContext,
  MermaidConfigContext,
  ControlsContext,
} from 'streamdown';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { Options } from 'react-markdown';
import { components } from './streamdown-components/components';

type ResponseProps = ComponentProps<typeof ReactMarkdown> & {
  className?: string;
};

const RemarkPlugins: Options['remarkPlugins'] = [remarkGfm, remarkMath];

const RehypePlugins: Options['rehypePlugins'] = [rehypeRaw, rehypeKatex];

export const Response = memo(
  ({ className, ...props }: ResponseProps) => {
    return (
      <ShikiThemeContext.Provider value={['github-light', 'github-dark']}>
        <MermaidConfigContext.Provider value={undefined}>
          <ControlsContext.Provider value={true}>
            <div
              className={cn(
                'size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_code]:whitespace-pre-wrap [&_code]:break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto',
                className,
              )}
            >
              <ReactMarkdown
                remarkPlugins={RemarkPlugins}
                rehypePlugins={RehypePlugins}
                components={{
                  ...components,
                  a: DatabricksMessageCitationStreamdownIntegration,
                }}
                {...props}
              />
            </div>
          </ControlsContext.Provider>
        </MermaidConfigContext.Provider>
      </ShikiThemeContext.Provider>
    );
  },
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);

Response.displayName = 'Response';
