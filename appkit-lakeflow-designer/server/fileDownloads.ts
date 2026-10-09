import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Response } from 'express';

export async function streamFileDownload(
  res: Response,
  stream: ReadableStream<Uint8Array>,
  filename: string,
  size: number,
  report: (error: unknown) => void,
) {
  const fallback = filename.replace(/[^A-Za-z0-9._ -]/g, '_');
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`);
  res.setHeader('Content-Length', String(size));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const reader = stream.getReader();
  const cancelRead = () => {
    void reader.cancel().catch(report);
  };
  res.once('close', cancelRead);
  async function* bytes() {
    let transferred = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        transferred += next.value.byteLength;
        if (transferred > size) throw new Error('File changed during transfer.');
        yield next.value;
      }
      if (transferred !== size) throw new Error('File transfer was incomplete.');
    } finally {
      res.off('close', cancelRead);
      await reader.cancel().catch(report);
      reader.releaseLock();
    }
  }
  await pipeline(Readable.from(bytes()), res);
}
