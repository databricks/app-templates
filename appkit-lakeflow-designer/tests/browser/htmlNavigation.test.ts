import { test } from 'node:test';
import { runBrowserFixture } from './runBrowserFixture.ts';

test('HTML output isolation in Chrome', { timeout: 60000 }, (context) =>
  runBrowserFixture(context, 'htmlNavigation.html'),
);
