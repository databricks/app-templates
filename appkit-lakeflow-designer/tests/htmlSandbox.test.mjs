import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HTML_OUTPUT_CSP, htmlOutputDocument } from '../client/src/htmlSandbox.ts';

test('HTML outputs allow inline interactivity and embedded media with no external resource sources', () => {
  const directives = Object.fromEntries(HTML_OUTPUT_CSP.split('; ').map((directive) => {
    const [name, ...sources] = directive.split(' ');
    return [name, sources];
  }));
  assert.deepEqual(directives['default-src'], ["'none'"]);
  assert.deepEqual(directives['script-src'], ["'unsafe-inline'"]);
  assert.deepEqual(directives['style-src'], ["'unsafe-inline'"]);
  for (const directive of ['connect-src', 'frame-src', 'worker-src', 'object-src', 'base-uri', 'form-action']) {
    assert.deepEqual(directives[directive], ["'none'"]);
  }
  for (const directive of ['img-src', 'font-src', 'media-src']) {
    assert.deepEqual(directives[directive], ['data:', 'blob:']);
  }
});

test('the security policy precedes author content without rewriting or supplying libraries', () => {
  const html = '<!doctype html><html><body><h1>東京</h1><script>window.answer = 42;</script></body></html>';
  const document = htmlOutputDocument(html);
  assert.ok(document.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"'));
  assert.ok(document.endsWith(html));
  assert.ok(document.indexOf('Content-Security-Policy') < document.indexOf('<script>'));
  assert.ok(document.includes("addEventListener('securitypolicyviolation'"));
});
