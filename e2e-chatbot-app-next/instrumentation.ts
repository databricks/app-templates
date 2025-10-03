import { StreamCache } from './lib/stream-cache';

declare global {
  var streamCache: StreamCache;
}

globalThis.streamCache = new StreamCache();
