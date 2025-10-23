import { expect, test } from 'vitest'
import { helloai-sdk-integration } from './index'

test('helloai-sdk-integration', () => {
  expect(helloai-sdk-integration()).toBe("Hello from ai-sdk-integration package!");
})