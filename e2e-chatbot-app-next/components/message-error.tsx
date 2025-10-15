'use client';
import { motion } from 'framer-motion';
import { TriangleAlert } from 'lucide-react';

export const MessageError = ({ error }: { error: string }) => {
  // Attempt to parse and format JSON error messages
  const formatError = (
    errorMessage: string,
  ): { formatted: string; isJson: boolean } => {
    try {
      const parsed = JSON.parse(errorMessage);
      return {
        formatted: JSON.stringify(parsed, null, 2),
        isJson: true,
      };
    } catch {
      return {
        formatted: errorMessage,
        isJson: false,
      };
    }
  };

  const { formatted } = formatError(error);

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative w-full"
    >
      <div className="flex w-fit items-center gap-1.5 rounded-t-md border border-destructive/20 border-b-0 bg-destructive/5 px-2.5 py-1.5">
        <div className="text-destructive">
          <TriangleAlert size={14} />
        </div>
        <span className="font-medium text-destructive text-xs">Error</span>
      </div>
      <div className="rounded-b-lg rounded-tr-lg border border-destructive/20">
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2.5 font-mono text-foreground text-xs">
          {formatted}
        </pre>
      </div>
    </motion.div>
  );
};
