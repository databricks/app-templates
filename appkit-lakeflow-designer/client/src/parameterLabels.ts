import type { AppParameter } from '../../server/plugins/designer/client';

export const labelFor = (name: string, parameters: AppParameter[]): string =>
  parameters.find((parameter) => parameter.name === name)?.label ?? name;

export const parameterLabel = ({ name, label }: AppParameter): string => (label === '' ? name : label);
