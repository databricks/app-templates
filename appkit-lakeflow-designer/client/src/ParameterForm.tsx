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
import { useId, useState, type FormEvent, type SetStateAction } from 'react';

import type { AppParameter } from './appConfig';
import { ComboboxParameterControl } from './ComboboxParameterControl';
import { FileParameterControl } from './FileParameterControl';
import { uploadFile, validateUpload } from './fileUpload';
import { parseMultiselectValue, toggleMultiselectValue } from '../../shared/multiselect';

interface UploadedFile {
  file: File;
  reference: string;
}

export function ParameterForm({
  parameters,
  values,
  onChange,
  onRun,
  running,
  runnable,
}: {
  parameters: AppParameter[];
  values: Record<string, string>;
  onChange: (next: SetStateAction<Record<string, string>>) => void;
  onRun: (values: Record<string, string>) => void;
  running: boolean;
  runnable: boolean;
}) {
  const [stagedFiles, setStagedFiles] = useState<Record<string, File | undefined>>({});
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, UploadedFile | undefined>>({});
  const [uploadErrors, setUploadErrors] = useState<Record<string, string | undefined>>({});
  const [uploading, setUploading] = useState(false);
  const set = (name: string, value: string) => onChange((current) => ({ ...current, [name]: value }));
  const fileParameters = parameters.filter(({ type }) => type === 'file');
  const disabled =
    running ||
    uploading ||
    !runnable ||
    fileParameters.some(({ name }) => stagedFiles[name] === undefined || uploadErrors[name] !== undefined);

  const stageFile = ({ name, fileFormats }: AppParameter, file: File) => {
    setStagedFiles((current) => ({ ...current, [name]: file }));
    setUploadedFiles((current) => ({ ...current, [name]: undefined }));
    setUploadErrors((current) => ({
      ...current,
      [name]: validateUpload(file, fileFormats),
    }));
    set(name, '');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) return;

    setUploading(true);
    setUploadErrors({});
    const nextValues = { ...values };
    const completed: Record<string, UploadedFile> = {};
    const errors: Record<string, string> = {};

    await Promise.all(
      fileParameters.map(async ({ name, fileFormats }) => {
        const file = stagedFiles[name];
        if (file === undefined) return;
        const previous = uploadedFiles[name];
        try {
          const reference = previous?.file === file ? previous.reference : await uploadFile(name, file, fileFormats);
          nextValues[name] = reference;
          completed[name] = { file, reference };
        } catch (error) {
          errors[name] = error instanceof Error ? error.message : 'The upload failed.';
        }
      })
    );

    setUploadedFiles((current) => ({ ...current, ...completed }));
    setUploadErrors(errors);
    setUploading(false);
    if (Object.keys(errors).length > 0) return;

    onChange(nextValues);
    onRun(nextValues);
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
