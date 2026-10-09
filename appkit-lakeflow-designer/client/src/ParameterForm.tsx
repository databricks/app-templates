import {
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@databricks/appkit-ui/react';
import { useEffect, useId, useRef, useState, type FormEvent, type SetStateAction } from 'react';

import type { AppParameter } from '../../shared/appManifest';
import { ComboboxParameterControl } from './ComboboxParameterControl';
import { FileParameterControl } from './FileParameterControl';
import { createFileUploadCache, UploadUnavailableError, validateUpload } from './fileUpload';
import { parseMultiselectValue, toggleMultiselectValue } from '../../shared/multiselect';

export function ParameterForm({
  parameters,
  values,
  onChange,
  onRun,
  onPrepareRun,
  onUploadUnavailable,
  running,
  runnable,
}: {
  parameters: AppParameter[];
  values: Record<string, string>;
  onChange: (next: SetStateAction<Record<string, string>>) => void;
  onRun: (values: Record<string, string>, signal: AbortSignal) => Promise<void>;
  onPrepareRun: () => Promise<boolean>;
  onUploadUnavailable: () => void;
  running: boolean;
  runnable: boolean;
}) {
  const [stagedFiles, setStagedFiles] = useState<Record<string, File | undefined>>({});
  const uploadCache = useRef<ReturnType<typeof createFileUploadCache> | undefined>(undefined);
  const submitting = useRef(false);
  const [uploadErrors, setUploadErrors] = useState<Record<string, string | undefined>>({});
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    const cache = createFileUploadCache();
    uploadCache.current = cache;
    return () => cache.dispose();
  }, []);
  const set = (name: string, value: string) => onChange((current) => ({ ...current, [name]: value }));
  const fileParameters = parameters.filter(({ type }) => type === 'file');
  const disabled =
    running ||
    uploading ||
    !runnable ||
    fileParameters.some(({ name }) => stagedFiles[name] === undefined || uploadErrors[name] !== undefined);

  const stageFile = ({ name, fileFormats }: AppParameter, file: File) => {
    setStagedFiles((current) => ({ ...current, [name]: file }));
    setUploadErrors((current) => ({
      ...current,
      [name]: validateUpload(file, fileFormats),
    }));
    set(name, '');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cache = uploadCache.current;
    if (disabled || submitting.current || cache === undefined) return;

    submitting.current = true;
    setUploading(true);
    setUploadErrors({});
    try {
      if (!(await onPrepareRun()) || cache.signal.aborted) return;
      const nextValues = { ...values };
      const errors: Record<string, string> = {};
      let unavailable = false;
      await Promise.all(fileParameters.map(async ({ name, fileFormats }) => {
        const file = stagedFiles[name];
        if (file === undefined) return;
        try {
          nextValues[name] = await cache.upload(name, file, fileFormats);
          if (!cache.signal.aborted) set(name, nextValues[name]);
        } catch (error) {
          unavailable ||= error instanceof UploadUnavailableError;
          errors[name] = error instanceof Error ? error.message : 'The upload failed.';
        }
      }));
      if (cache.signal.aborted) return;
      if (unavailable) {
        onUploadUnavailable();
        return;
      }
      setUploadErrors(errors);
      if (Object.keys(errors).length > 0) return;
      onChange(nextValues);
      await onRun(nextValues, cache.signal);
    } finally {
      submitting.current = false;
      if (!cache.signal.aborted) setUploading(false);
    }
  };

  return (
    <form className="grid gap-4 p-6" onSubmit={(event) => void submit(event)}>
      {parameters.map((parameter) => (
        <div
          key={parameter.name}
          className="grid gap-1.5 sm:grid-cols-[minmax(10rem,16rem)_minmax(0,1fr)] sm:items-start sm:gap-4"
        >
          <Label htmlFor={parameter.type === 'multiselect' ? undefined : parameter.name} className="sm:pt-2.5">
            {parameter.label === '' ? parameter.name : parameter.label}
          </Label>
          <div className="grid gap-1.5">
            {parameter.type === 'file' ? (
              <FileParameterControl
                name={parameter.name}
                fileFormats={parameter.fileFormats}
                file={stagedFiles[parameter.name]}
                uploadReference={values[parameter.name]}
                error={uploadErrors[parameter.name]}
                onFileChange={(file) => stageFile(parameter, file)}
                disabled={running || uploading || !runnable}
              />
            ) : (
              <ParameterControl
                parameter={parameter}
                value={values[parameter.name] ?? parameter.defaultValue}
                onValueChange={(value) => set(parameter.name, value)}
              />
            )}
            {parameter.help === undefined ? null : <p className="text-muted-foreground text-xs">{parameter.help}</p>}
          </div>
        </div>
      ))}

      {parameters.length === 0 ? <p className="text-muted-foreground text-xs">This app takes no parameters.</p> : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={disabled} className="px-6">
          {uploading ? 'Uploading…' : running ? 'Running…' : 'Run'}
        </Button>
      </div>
    </form>
  );
}

function ParameterControl({
  parameter,
  value,
  onValueChange,
}: {
  parameter: AppParameter;
  value: string;
  onValueChange: (value: string) => void;
}) {
  const suggestionListId = useId();
  if (parameter.type === 'multiselect') {
    const selections = new Set(parseMultiselectValue(value));
    return (
      <div
        role="group"
        aria-label={parameter.label === '' ? parameter.name : parameter.label}
        className="grid max-h-40 gap-2 overflow-y-auto rounded-md border px-3 py-2.5"
      >
        {[...new Set(parameter.choices ?? [])].map((choice, index) => {
          const choiceId = `${suggestionListId}-${index}`;
          return (
            <div key={choice} className="flex items-center gap-2">
              <Checkbox
                id={choiceId}
                checked={selections.has(choice)}
                onCheckedChange={(checked) => onValueChange(toggleMultiselectValue(value, choice, checked === true))}
              />
              <Label htmlFor={choiceId}>{choice}</Label>
            </div>
          );
        })}
      </div>
    );
  }
  if (parameter.type === 'combobox') {
    return (
      <ComboboxParameterControl parameter={parameter} value={value} onValueChange={onValueChange} />
    );
  }
  if (parameter.type === 'dropdown' && parameter.choices !== undefined) {
    return (
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={parameter.name} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {parameter.choices.map((choice) => (
            <SelectItem key={choice} value={choice}>
              {choice}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Input
      id={parameter.name}
      inputMode={parameter.type === 'number' ? 'decimal' : undefined}
      spellCheck={false}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    />
  );
}
