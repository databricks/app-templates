import { test } from 'node:test';
import { runBrowserFixture } from './runBrowserFixture.ts';

await test('App startup recovery across real page reloads in Chrome', { timeout: 60000 }, (context) =>
  runBrowserFixture(context, 'startupRecovery.html')
);
