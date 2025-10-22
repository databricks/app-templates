'use client';

import { cn } from '@/lib/utils';
import type { HTMLAttributes, ReactNode } from 'react';
import { createContext } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
  oneDark,
  oneLight,
} from 'react-syntax-highlighter/dist/esm/styles/prism';

type CodeBlockContextType = {
  code: string;
};

const CodeBlockContext = createContext<CodeBlockContextType>({
  code: '',
});

type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string;
  language: string;
  showLineNumbers?: boolean;
  children?: ReactNode;
};

export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
  className,
  children,
  ...props
}: CodeBlockProps) => (
  <CodeBlockContext.Provider value={{ code }}>
    <div
      className={cn(
        'relative w-full overflow-hidden rounded-md border bg-background text-foreground',
        className,
      )}
      {...props}
    >
      <div className="relative">
        <SyntaxHighlighter
          className="overflow-hidden dark:hidden"
          codeTagProps={{
            className: 'font-mono text-sm',
          }}
          customStyle={{
            margin: 0,
            padding: '1rem',
            fontSize: '0.875rem',
            background: 'hsl(var(--background))',
            color: 'hsl(var(--foreground))',
            overflowX: 'auto',
            overflowWrap: 'break-word',
            wordBreak: 'break-all',
          }}
          language={language}
          lineNumberStyle={{
            color: 'hsl(var(--muted-foreground))',
            paddingRight: '1rem',
            minWidth: '2.5rem',
          }}
          showLineNumbers={showLineNumbers}
          style={oneLight}
        >
          {code}
        </SyntaxHighlighter>
        <SyntaxHighlighter
          className="hidden overflow-hidden dark:block"
          codeTagProps={{
            className: 'font-mono text-sm',
          }}
          customStyle={{
            margin: 0,
            padding: '1rem',
            fontSize: '0.875rem',
            background: 'hsl(var(--background))',
            color: 'hsl(var(--foreground))',
            overflowX: 'auto',
            overflowWrap: 'break-word',
            wordBreak: 'break-all',
          }}
          language={language}
          lineNumberStyle={{
            color: 'hsl(var(--muted-foreground))',
            paddingRight: '1rem',
            minWidth: '2.5rem',
          }}
          showLineNumbers={showLineNumbers}
          style={oneDark}
        >
          {code}
        </SyntaxHighlighter>
        {children && (
          <div className="absolute top-2 right-2 flex items-center gap-2">
            {children}
          </div>
        )}
      </div>
    </div>
  </CodeBlockContext.Provider>
);
