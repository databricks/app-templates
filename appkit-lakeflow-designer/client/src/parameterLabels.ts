import type { AppParameter } from '../../shared/appManifest';

export const labelFor = (name: string, parameters: AppParameter[]): string =>
  parameters.find((parameter) => parameter.name === name)?.label ?? name;
