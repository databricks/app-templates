import { isTestEnvironment } from './lib/constants';
import { StreamCache } from './lib/stream-cache';

declare global {
  var streamCache: StreamCache;
}

globalThis.streamCache = new StreamCache();

export async function register() {
  // The only host we don't want to mock is the local host
  const unmocked = ['localhost:3000'];

  // Only register the mock server in test environment
  // and only if the NEXT_RUNTIME is nodejs (meaning server side)
  if (process.env.NEXT_RUNTIME === 'nodejs' && isTestEnvironment) {
    const { mockServer } = await import('./tests/api-mocking/api-mock-server');

    mockServer.listen({
      onUnhandledRequest(request, print) {
        const url = new URL(request.url);
        if (unmocked.some((host) => url.hostname.includes(host))) {
          return;
        }

        // Print the regular MSW unhandled request warning otherwise.
        print.warning();
        throw new Error('Unhandled external request in test environment');
      },
    });
  }
}
