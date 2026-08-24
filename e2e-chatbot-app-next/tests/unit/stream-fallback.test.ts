import { expect, test } from '@playwright/test';
import { drainStreamToWriter } from '../../server/src/lib/stream-fallback';

test('handled failure before text triggers fallback without noisy output', async () => {
  const originalError = console.error;
  const originalDebug = console.debug;
  const errorLogs: unknown[][] = [];
  const debugLogs: unknown[][] = [];
  console.error = (...args: unknown[]) => errorLogs.push(args);
  console.debug = (...args: unknown[]) => debugLogs.push(args);

  try {
    const stream = new ReadableStream({
      start(controller) {
        controller.error(new Error('expected upstream stream failure'));
      },
    });
    const result = await drainStreamToWriter(stream, {
      write() {},
    } as never);

    expect(result).toEqual({ failed: true });
    expect(errorLogs).toEqual([]);
    expect(debugLogs).toEqual([]);
  } finally {
    console.error = originalError;
    console.debug = originalDebug;
  }
});
