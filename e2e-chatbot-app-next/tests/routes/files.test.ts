import { expect, test } from '../fixtures';

test.describe('/api/files/databricks-file', () => {
  test('returns 400 when file path is missing', async ({ adaContext }) => {
    const response = await adaContext.request.post(
      '/api/files/databricks-file',
      {
        data: {},
      },
    );
    expect(response.status()).toBe(400);

    const json = await response.json();
    expect(json.error).toEqual('File path is required in request body');
  });

  test('returns 400 when file path is not a string', async ({ adaContext }) => {
    const response = await adaContext.request.post(
      '/api/files/databricks-file',
      {
        data: { path: 123 },
      },
    );
    expect(response.status()).toBe(400);

    const json = await response.json();
    expect(json.error).toEqual('File path is required in request body');
  });

  test('Ada can fetch a PDF file from Databricks', async ({ adaContext }) => {
    const response = await adaContext.request.post(
      '/api/files/databricks-file',
      {
        data: { path: '/Volumes/catalog/schema/volume/test.pdf' },
      },
    );
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('application/pdf');

    const buffer = await response.body();
    expect(buffer).toBeTruthy();
    expect(buffer.toString()).toContain('Mock PDF content');
  });

  test('Ada can fetch a JSON file from Databricks', async ({ adaContext }) => {
    const response = await adaContext.request.post(
      '/api/files/databricks-file',
      {
        data: { path: '/Volumes/catalog/schema/volume/data.json' },
      },
    );
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('application/json');

    const json = await response.json();
    expect(json).toEqual({ message: 'Mock JSON data' });
  });

  test('infers content type from file extension', async ({ adaContext }) => {
    const response = await adaContext.request.post(
      '/api/files/databricks-file',
      {
        data: { path: '/Volumes/catalog/schema/volume/document.txt' },
      },
    );
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('text/plain');
  });

  test('defaults to application/octet-stream for unknown extensions', async ({
    adaContext,
  }) => {
    const response = await adaContext.request.post(
      '/api/files/databricks-file',
      {
        data: { path: '/Volumes/catalog/schema/volume/file.unknown' },
      },
    );
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('application/octet-stream');
  });

  test('handles paths without leading slash', async ({ adaContext }) => {
    const response = await adaContext.request.post(
      '/api/files/databricks-file',
      {
        data: { path: 'Volumes/catalog/schema/volume/test.pdf' },
      },
    );
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('application/pdf');
  });

  test('returns 404 when file not found in Databricks', async ({
    adaContext,
  }) => {
    const response = await adaContext.request.post(
      '/api/files/databricks-file',
      {
        data: { path: '/Volumes/catalog/schema/volume/nonexistent.pdf' },
      },
    );
    expect(response.status()).toBe(404);

    const json = await response.json();
    expect(json.error).toEqual('File not found');
  });

  test('returns 403 when permission denied by Databricks', async ({
    adaContext,
  }) => {
    const response = await adaContext.request.post(
      '/api/files/databricks-file',
      {
        data: { path: '/Volumes/catalog/schema/volume/forbidden.pdf' },
      },
    );
    expect(response.status()).toBe(403);

    const json = await response.json();
    expect(json.error).toEqual('Permission denied');
  });

  test('forwards Content-Length header from Databricks', async ({
    adaContext,
  }) => {
    const response = await adaContext.request.post(
      '/api/files/databricks-file',
      {
        data: { path: '/Volumes/catalog/schema/volume/test.pdf' },
      },
    );
    expect(response.status()).toBe(200);

    const contentLength = response.headers()['content-length'];
    expect(contentLength).toBeTruthy();
    expect(Number.parseInt(contentLength)).toBeGreaterThan(0);
  });

  test('forwards Content-Disposition header from Databricks', async ({
    adaContext,
  }) => {
    const response = await adaContext.request.post(
      '/api/files/databricks-file',
      {
        data: { path: '/Volumes/catalog/schema/volume/download.pdf' },
      },
    );
    expect(response.status()).toBe(200);

    const contentDisposition = response.headers()['content-disposition'];
    expect(contentDisposition).toBe('attachment; filename="download.pdf"');
  });

  test('handles large file streaming', async ({ adaContext }) => {
    const response = await adaContext.request.post(
      '/api/files/databricks-file',
      {
        data: { path: '/Volumes/catalog/schema/volume/large.pdf' },
      },
    );
    expect(response.status()).toBe(200);

    const buffer = await response.body();
    expect(buffer).toBeTruthy();
    // Large file should be at least 1MB
    expect(buffer.length).toBeGreaterThan(1024 * 1024);
  });

  test('handles files without body stream (fallback to buffer)', async ({
    adaContext,
  }) => {
    const response = await adaContext.request.post(
      '/api/files/databricks-file',
      {
        data: { path: '/Volumes/catalog/schema/volume/no-stream.pdf' },
      },
    );
    expect(response.status()).toBe(200);

    const buffer = await response.body();
    expect(buffer).toBeTruthy();
    expect(buffer.toString()).toContain('Buffer fallback content');
  });

  test('handles various image file types', async ({ adaContext }) => {
    const testCases = [
      {
        path: '/Volumes/catalog/schema/volume/image.png',
        contentType: 'image/png',
      },
      {
        path: '/Volumes/catalog/schema/volume/image.jpg',
        contentType: 'image/jpeg',
      },
      {
        path: '/Volumes/catalog/schema/volume/image.gif',
        contentType: 'image/gif',
      },
      {
        path: '/Volumes/catalog/schema/volume/image.svg',
        contentType: 'image/svg+xml',
      },
    ];

    for (const { path, contentType } of testCases) {
      const response = await adaContext.request.post(
        '/api/files/databricks-file',
        {
          data: { path },
        },
      );
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toBe(contentType);
    }
  });

  test('handles other Databricks API errors', async ({ adaContext }) => {
    const response = await adaContext.request.post(
      '/api/files/databricks-file',
      {
        data: { path: '/Volumes/catalog/schema/volume/server-error.pdf' },
      },
    );
    expect(response.status()).toBe(500);

    const json = await response.json();
    expect(json.error).toContain('Failed to fetch file');
  });
});
