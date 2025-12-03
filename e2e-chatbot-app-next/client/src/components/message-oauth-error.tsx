import { motion } from 'framer-motion';
import { useState } from 'react';
import {
  LogIn,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  KeyRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MessageOAuthErrorProps {
  error: string;
  connectionName: string;
  loginUrl: string;
  onRetry: () => void;
}

export const MessageOAuthError = ({
  error,
  connectionName,
  loginUrl,
  onRetry,
}: MessageOAuthErrorProps) => {
  const [showDetails, setShowDetails] = useState(false);

  const handleLogin = () => {
    window.open(loginUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative w-full"
    >
      <div className="flex w-fit items-center gap-1.5 rounded-t-md border border-amber-500/20 border-b-0 bg-amber-500/5 px-2.5 py-1.5">
        <div className="text-amber-600 dark:text-amber-500">
          <KeyRound size={14} />
        </div>
        <span className="font-medium text-amber-600 dark:text-amber-500 text-xs">
          Login Required
        </span>
      </div>

      <div className="rounded-b-lg rounded-tr-lg border border-amber-500/20 bg-amber-500/5 p-3">
        <p className="text-sm text-foreground mb-3">
          To continue, please login to{' '}
          <span className="font-medium">{connectionName}</span>
        </p>

        <div className="flex items-center gap-2 mb-2">
          <Button onClick={handleLogin} size="sm" className="gap-1.5">
            <LogIn size={14} />
            Login
          </Button>
          <Button
            onClick={onRetry}
            variant="outline"
            size="sm"
            className="gap-1.5"
          >
            <RefreshCw size={14} />
            Retry
          </Button>
        </div>

        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          type="button"
        >
          {showDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {showDetails ? 'Hide details' : 'Show details'}
        </button>

        {showDetails && (
          <motion.pre
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2.5 font-mono text-foreground text-xs"
          >
            {error}
          </motion.pre>
        )}
      </div>
    </motion.div>
  );
};
