import { useEffect, useState } from 'react';
import { Button } from '@databricks/appkit-ui/react';

type Mode = 'system' | 'light' | 'dark';

const MODES: Mode[] = ['system', 'light', 'dark'];
const LABELS: Record<Mode, string> = { system: 'System', light: 'Light', dark: 'Dark' };

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>('system');

  // Tailwind dark: follows OS preference; this toggle uses explicit .light and .dark classes.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    if (mode !== 'system') root.classList.add(mode);
  }, [mode]);

  return (
    <div className="border-border inline-flex overflow-hidden rounded-md border" role="group" aria-label="Theme">
      {MODES.map((candidate) => (
        <Button
          key={candidate}
          type="button"
          size="sm"
          variant={mode === candidate ? 'secondary' : 'ghost'}
          className="rounded-none border-0 text-xs"
          aria-pressed={mode === candidate}
          onClick={() => setMode(candidate)}
        >
          {LABELS[candidate]}
        </Button>
      ))}
    </div>
  );
}
