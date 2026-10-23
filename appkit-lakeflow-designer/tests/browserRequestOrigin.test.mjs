import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSameOriginBrowserRequest } from '../server/browserRequestOrigin.ts';

test('allows the App page and authenticated non-browser API clients', () => {
  for (const headers of [
    {},
    { fetchSite: 'same-origin' },
    { fetchSite: 'none' },
    { origin: 'https://example.test', appUrl: 'https://example.test', fetchSite: 'same-origin' },
    { origin: 'https://example.test', appUrl: 'https://example.test:443/' },
    { origin: 'http://localhost:5173', appUrl: 'http://localhost:5173' },
  ]) {
    assert.equal(isSameOriginBrowserRequest(headers), true);
  }
});

test('rejects opaque frame origins, sibling sites, and external browser requests', () => {
  for (const headers of [
    { origin: 'null', appUrl: 'https://example.test' },
    { fetchSite: 'cross-site' },
    { fetchSite: 'same-site' },
    { origin: 'https://other.example.test', appUrl: 'https://example.test' },
    { origin: 'https://example.test', appUrl: 'https://example.test', fetchSite: 'cross-site' },
    { origin: 'https://example.test:444', appUrl: 'https://example.test' },
    { origin: 'http://example.test', appUrl: 'https://example.test' },
    { origin: 'https://example.test/path', appUrl: 'https://example.test' },
    { origin: 'not-an-origin', appUrl: 'https://example.test' },
    { origin: 'https://example.test', appUrl: 'not-a-url' },
    { origin: 'https://example.test' },
  ]) {
    assert.equal(isSameOriginBrowserRequest(headers), false);
  }
});
