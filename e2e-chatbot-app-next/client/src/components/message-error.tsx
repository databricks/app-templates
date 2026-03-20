import { motion } from 'framer-motion';
import { WarningIcon } from './icons';

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
      <div className="flex gap-1.5 items-center mb-1">
        <div className="text-destructive">
          <WarningIcon size={14} />
        </div>
        <span className="font-medium text-destructive text-base">Error</span>
      </div>
      <div className="rounded-xl overflow-hidden border border-destructive/40">
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2.5 font-mono text-foreground">
          {formatted}
        </pre>
      </div>
    </motion.div>
  );
};
