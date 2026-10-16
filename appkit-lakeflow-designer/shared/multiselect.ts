const MULTISELECT_DELIMITER = ',';

export function parseMultiselectValue(value: string): string[] {
  return value === '' ? [] : value.split(MULTISELECT_DELIMITER);
}

export function isValidMultiselectValue(value: unknown, choices: readonly string[]): value is string {
  return typeof value === 'string' && parseMultiselectValue(value).every((choice) => choices.includes(choice));
}

export function isValidMultiselectConfig(choices: unknown, defaultValue: unknown): boolean {
  return (
    Array.isArray(choices) &&
    choices.length > 0 &&
    choices.every(
      (choice): choice is string =>
        typeof choice === 'string' && choice !== '' && !choice.includes(MULTISELECT_DELIMITER),
    ) &&
    isValidMultiselectValue(defaultValue === undefined ? '' : defaultValue, choices)
  );
}

export function toggleMultiselectValue(value: string, choice: string, selected: boolean): string {
  const selections = new Set(parseMultiselectValue(value));
  if (selected) selections.add(choice);
  else selections.delete(choice);
  return [...selections].join(MULTISELECT_DELIMITER);
}
