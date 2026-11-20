import { isRecord } from './values.ts';

export const RUNNER_REVISION_PARAM = '_lb_runner_revision';
export const APP_UPDATING_MESSAGE =
  'This App is updating. New runs are paused until publication finishes. Try again shortly.';

export interface PublishedRunner {
  revision: string;
  parameters: Record<string, string>;
}

export function isPublishedRunner(runner: PublishedRunner | undefined, job: unknown): boolean {
  if (!runner || !isRecord(job) || !isRecord(job.settings) || !Array.isArray(job.settings.tasks)) return false;
  if (job.settings.tasks.length !== 1) return false;
  const task: unknown = job.settings.tasks[0];
  if (!isRecord(task) || !isRecord(task.notebook_task)) return false;
  const notebook = task.notebook_task;
  const parameters = notebook.base_parameters;
  return (
    typeof notebook.notebook_path === 'string' &&
    notebook.notebook_path.endsWith(`/runner-${runner.revision}.designer.py`) &&
    isRecord(parameters) &&
    Object.keys(parameters).length === Object.keys(runner.parameters).length &&
    Object.entries(runner.parameters).every(([name, value]) => parameters[name] === value)
  );
}
