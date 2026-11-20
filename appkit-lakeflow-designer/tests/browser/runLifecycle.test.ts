import { test } from 'node:test';
import { runBrowserFixture } from './runBrowserFixture.ts';

await test('App run tracking and republish recovery in Chrome', { timeout: 60000 }, (context) =>
  runBrowserFixture(context, 'runLifecycle.html')
);
