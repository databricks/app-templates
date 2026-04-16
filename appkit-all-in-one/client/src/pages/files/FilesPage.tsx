import type { DirectoryEntry, FilePreview } from '@databricks/appkit-ui/react';
import {
  Button,
  DirectoryList,
  FileBreadcrumb,
  FilePreviewPanel,
  NewFolderInput,
} from '@databricks/appkit-ui/react';
import { FolderPlus, Loader2, Upload } from 'lucide-react';
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

function useAbortController(): RefObject<AbortController | null> {
  const ref = useRef<AbortController | null>(null);
  return ref;
}

function nextSignal(ref: RefObject<AbortController | null>): AbortSignal {
  ref.current?.abort();
  ref.current = new AbortController();
  return ref.current.signal;
}

export function FilesPage() {
  const [volumes, setVolumes] = useState<string[]>([]);
  const [volumeKey, setVolumeKey] = useState<string>(
    () => localStorage.getItem('appkit:files:volumeKey') ?? '',
  );
  const [currentPath, setCurrentPath] = useState<string>('');
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creatingDir, setCreatingDir] = useState(false);
  const [newDirName, setNewDirName] = useState('');
  const [showNewDirInput, setShowNewDirInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listAbort = useAbortController();
  const previewAbort = useAbortController();

  const normalize = (p: string) => p.replace(/\/+$/, '');
  const isAtRoot = !currentPath;

  const apiUrl = useCallback(
    (action: string, params?: Record<string, string>) => {
      const base = `/api/files/${volumeKey}/${action}`;
      if (!params) return base;
      const qs = new URLSearchParams(params).toString();
      return `${base}?${qs}`;
    },
    [volumeKey],
  );

  const loadDirectory = useCallback(
    async (path?: string) => {
      if (!volumeKey) return;
      setLoading(true);
      setError(null);
      setSelectedFile(null);
      setPreview(null);

      try {
        const signal = nextSignal(listAbort);
        const url = path ? apiUrl('list', { path }) : apiUrl('list');
        const response = await fetch(url, { signal });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(
            data.error ?? `HTTP ${response.status}: ${response.statusText}`,
          );
        }

        const data: DirectoryEntry[] = await response.json();
        data.sort((a, b) => {
          if (a.is_directory && !b.is_directory) return -1;
          if (!a.is_directory && b.is_directory) return 1;
          return (a.name ?? '').localeCompare(b.name ?? '');
        });
        setEntries(data);
        setCurrentPath(path ?? '');
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [volumeKey, apiUrl, listAbort],
  );

  const loadPreview = useCallback(
    async (filePath: string) => {
      setPreviewLoading(true);
      setPreview(null);

      try {
        const signal = nextSignal(previewAbort);
        const response = await fetch(apiUrl('preview', { path: filePath }), {
          signal,
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${response.status}`);
        }

        const data = await response.json();
        setPreview(data);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setPreview(null);
      } finally {
        setPreviewLoading(false);
      }
    },
    [apiUrl, previewAbort],
  );

  useEffect(() => {
    fetch('/api/files/volumes')
      .then((res) => res.json())
      .then((data: { volumes: string[] }) => {
        const list = data.volumes ?? [];
        setVolumes(list);
        if (!volumeKey || !list.includes(volumeKey)) {
          const first = list[0];
          if (first) {
            setVolumeKey(first);
            localStorage.setItem('appkit:files:volumeKey', first);
          }
        }
      })
      .catch(() => {});
  }, [volumeKey]);

  useEffect(() => {
    if (volumeKey) {
      loadDirectory();
    }
  }, [volumeKey, loadDirectory]);

  const resolveEntryPath = (entry: DirectoryEntry) => {
    const name = entry.name ?? '';
    return currentPath ? `${currentPath}/${name}` : name;
  };

  const handleEntryClick = (entry: DirectoryEntry) => {
    const entryPath = resolveEntryPath(entry);
    if (entry.is_directory) {
      loadDirectory(entryPath);
    } else {
      setSelectedFile(entryPath);
      loadPreview(entryPath);
    }
  };

  const navigateToParent = () => {
    if (isAtRoot) return;
    const segments = currentPath.split('/').filter(Boolean);
    segments.pop();
    const parentPath = segments.join('/');
    loadDirectory(parentPath || undefined);
  };

  const allSegments = normalize(currentPath).split('/').filter(Boolean);

  const navigateToBreadcrumb = (index: number) => {
    const targetSegments = allSegments.slice(0, index + 1);
    const targetPath = targetSegments.join('/');
    loadDirectory(targetPath);
  };

  const MAX_UPLOAD_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_UPLOAD_SIZE) {
      setError(
        `File "${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum upload size is ${MAX_UPLOAD_SIZE / 1024 / 1024 / 1024} GB.`,
      );
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setUploading(true);
    try {
      const uploadPath = currentPath
        ? `${currentPath}/${file.name}`
        : file.name;
      const response = await fetch(apiUrl('upload', { path: uploadPath }), {
        method: 'POST',
        body: file,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? `Upload failed (${response.status})`);
      }

      await loadDirectory(currentPath || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDelete = async () => {
    if (!selectedFile) return;

    const fileName = selectedFile.split('/').pop();
    if (!window.confirm(`Delete "${fileName}"?`)) return;

    setDeleting(true);
    try {
      const response = await fetch(
        `/api/files/${volumeKey}?path=${encodeURIComponent(selectedFile)}`,
        { method: 'DELETE' },
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? `Delete failed (${response.status})`);
      }

      setSelectedFile(null);
      setPreview(null);
      await loadDirectory(currentPath || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const handleCreateDirectory = async () => {
    const name = newDirName.trim();
    if (!name) return;

    setCreatingDir(true);
    try {
      const dirPath = currentPath ? `${currentPath}/${name}` : name;
      const response = await fetch(apiUrl('mkdir'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          data.error ?? `Create directory failed (${response.status})`,
        );
      }

      setShowNewDirInput(false);
      setNewDirName('');
      await loadDirectory(currentPath || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingDir(false);
    }
  };

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Files</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Browse and manage files in Databricks Volumes.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {volumes.length > 1 && (
            <select
              value={volumeKey}
              onChange={(e) => {
                const v = e.target.value;
                setVolumeKey(v);
                localStorage.setItem('appkit:files:volumeKey', v);
                setCurrentPath('');
                setEntries([]);
                setSelectedFile(null);
                setPreview(null);
              }}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              {volumes.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          )}
          <FileBreadcrumb
            rootLabel={volumeKey || 'Root'}
            segments={allSegments}
            onNavigateToRoot={() => loadDirectory()}
            onNavigateToSegment={navigateToBreadcrumb}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowNewDirInput(true)}
          >
            <FolderPlus className="h-4 w-4 mr-2" />
            New Folder
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleUpload}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            {uploading ? 'Uploading...' : 'Upload'}
          </Button>
        </div>
      </div>

      <div className="flex gap-6">
        <DirectoryList
          className="flex-2 min-w-0"
          entries={entries}
          loading={loading}
          error={error}
          onEntryClick={handleEntryClick}
          onNavigateToParent={navigateToParent}
          onRetry={() => loadDirectory(currentPath || undefined)}
          isAtRoot={isAtRoot}
          selectedPath={selectedFile}
          resolveEntryPath={resolveEntryPath}
          hasCurrentPath={!!currentPath}
          headerContent={
            showNewDirInput ? (
              <NewFolderInput
                value={newDirName}
                onChange={setNewDirName}
                onCreate={handleCreateDirectory}
                onCancel={() => {
                  setShowNewDirInput(false);
                  setNewDirName('');
                }}
                creating={creatingDir}
              />
            ) : undefined
          }
        />

        <FilePreviewPanel
          className="flex-1 min-w-0"
          selectedFile={selectedFile}
          preview={preview}
          previewLoading={previewLoading}
          onDownload={(path) =>
            window.open(apiUrl('download', { path }), '_blank')
          }
          onDelete={handleDelete}
          deleting={deleting}
          imagePreviewSrc={(p) => apiUrl('raw', { path: p })}
        />
      </div>
    </div>
  );
}
