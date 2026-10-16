export function runJobParameters(run: unknown): Record<string, string> {
  if (typeof run !== 'object' || run === null || !('job_parameters' in run) || !Array.isArray(run.job_parameters)) {
    return {};
  }
  const parameters: Record<string, string> = {};
  for (const parameter of run.job_parameters) {
    if (
      typeof parameter === 'object' && parameter !== null &&
      typeof parameter.name === 'string' && typeof parameter.value === 'string'
    ) {
      Object.defineProperty(parameters, parameter.name, {
        value: parameter.value, enumerable: true, configurable: true, writable: true,
      });
    }
  }
  return parameters;
}
