import { useMemo, useState } from 'react';
import { marked } from 'marked';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Badge,
  Button,
} from '@databricks/appkit-ui/react';
import { RefreshCw, Database, ChevronDown, ChevronRight } from 'lucide-react';
import type { SpaceInfo } from './types';

marked.setOptions({ gfm: true, breaks: true });

interface Props {
  spaces: SpaceInfo[];
  selectedAlias: string | null;
  onSelect: (alias: string) => void;
  onRefresh: () => void;
  loading: boolean;
}

export function SpacePicker({
  spaces,
  selectedAlias,
  onSelect,
  onRefresh,
  loading,
}: Props) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Genie Space
        </label>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={loading}
          className="h-6 px-2"
          aria-label="Refresh spaces"
        >
          <RefreshCw
            className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`}
          />
        </Button>
      </div>
      <Select
        value={selectedAlias ?? ''}
        onValueChange={onSelect}
        disabled={spaces.length === 0}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={loading ? 'Loading…' : 'Pick a space'} />
        </SelectTrigger>
        <SelectContent>
          {spaces.map((space) => (
            <SelectItem
              key={space.alias}
              value={space.alias}
              disabled={!space.accessible}
            >
              <div className="flex items-center gap-2">
                <Database className="h-3.5 w-3.5 shrink-0" />
                <span className="font-medium">{space.title}</span>
                {!space.accessible && (
                  <Badge variant="destructive" className="text-[10px]">
                    no access
                  </Badge>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selectedAlias && (
        <SpaceMeta
          space={spaces.find((s) => s.alias === selectedAlias)}
        />
      )}
    </div>
  );
}

function SpaceMeta({ space }: { space: SpaceInfo | undefined }) {
  const [expanded, setExpanded] = useState(false);
  const description = space?.description ?? '';
  const html = useMemo(
    () => (description ? (marked.parse(description) as string) : ''),
    [description],
  );
  if (!space) return null;
  const hasDescription = description.trim().length > 0;
  return (
    <div className="text-xs text-muted-foreground space-y-1.5 pt-1">
      {hasDescription && (
        <div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-medium hover:text-foreground transition-colors"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            About this space
          </button>
          {expanded ? (
            <div
              className="space-description leading-relaxed mt-1.5"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <p className="leading-relaxed mt-1 line-clamp-2">
              {description}
            </p>
          )}
        </div>
      )}
      <p className="font-mono text-[10px] truncate" title={space.space_id}>
        id: {space.space_id}
      </p>
    </div>
  );
}
