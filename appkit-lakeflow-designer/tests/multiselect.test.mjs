import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isValidMultiselectConfig,
  isValidMultiselectValue,
  parseMultiselectValue,
  toggleMultiselectValue,
} from '../shared/multiselect.ts';

test('parses empty selections and preserves selection order and whitespace', () => {
  assert.deepEqual(parseMultiselectValue(''), []);
  assert.deepEqual(parseMultiselectValue('us-west, us-east ,eu-west'), ['us-west', ' us-east ', 'eu-west']);
});

test('toggles offered values without reordering, duplicating or defaulting an empty selection', () => {
  assert.equal(toggleMultiselectValue('eu-west,us-west', ' us-east ', true), 'eu-west,us-west, us-east ');
  assert.equal(toggleMultiselectValue('eu-west,us-west', 'us-west', true), 'eu-west,us-west');
  assert.equal(toggleMultiselectValue('eu-west,us-west', 'eu-west', false), 'us-west');
  assert.equal(toggleMultiselectValue('us-west', 'us-west', false), '');
  assert.equal(toggleMultiselectValue('', ' us-east ', true), ' us-east ');
});

const choices = ['us-west', ' us-east ', 'eu-west'];

for (const [value, valid] of [
  ['', true],
  ['us-west', true],
  ['eu-west,us-west', true],
  [' us-east ', true],
  ['us-east', false],
  ['unknown', false],
  ['us-west,', false],
  [',us-west', false],
  ['us-west,,eu-west', false],
  [null, false],
  [undefined, false],
  [['us-west'], false],
  [42, false],
]) {
  test(`validates the submitted multi-select value ${JSON.stringify(value)}`, () => {
    assert.equal(isValidMultiselectValue(value, choices), valid);
  });
}

for (const [domain, defaultValue, valid] of [
  [choices, 'us-west, us-east ', true],
  [choices, '', true],
  [choices, undefined, true],
  [undefined, '', false],
  [[], '', false],
  [['us-west', ''], '', false],
  [['us-west', 'us-east,eu-west'], '', false],
  [['us-west', 42], '', false],
  [choices, 'unknown', false],
  [choices, 'us-west,', false],
  [choices, null, false],
  [choices, ['us-west'], false],
]) {
  test(`validates domain ${JSON.stringify(domain)} with default ${JSON.stringify(defaultValue)}`, () => {
    assert.equal(isValidMultiselectConfig(domain, defaultValue), valid);
  });
}
