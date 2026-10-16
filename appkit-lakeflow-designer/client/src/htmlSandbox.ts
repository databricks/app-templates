// Block external subresources while preserving inline scripts and embedded media.
export const HTML_OUTPUT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data: blob:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

// The parent policy also restricts navigation of the output frame itself.
export const HTML_OUTPUT_WRAPPER_CSP = "frame-src 'none'";
export const HTML_OUTPUT_WRAPPER_DOCUMENT = '<!doctype html><html><head>' +
  '<meta http-equiv="Content-Security-Policy" content="' + HTML_OUTPUT_WRAPPER_CSP + '">' +
  '</head><body></body></html>';

// The frame can report display state only; it has no bridge to App credentials or APIs.
const FRAME_BOOTSTRAP = `<script>
(function () {
  function report(value) { parent.postMessage(Object.assign({type: 'designer-html'}, value), '*'); }
  function error(message) { report({error: String(message).slice(0, 2000)}); }
  addEventListener('error', function (event) {
    error(event.message || 'An HTML script or resource could not be loaded.');
  }, true);
  addEventListener('unhandledrejection', function (event) { error(event.reason); });
  addEventListener('securitypolicyviolation', function (event) {
    error('The HTML output security policy blocked a resource or operation (' + event.effectiveDirective + '). External resources are disabled.');
  });
  addEventListener('load', function () {
    new ResizeObserver(function () { report({height: document.documentElement.scrollHeight}); }).observe(document.body);
  });
}());
</script>`;

export function htmlOutputDocument(html: string): string {
  // A policy before all author content cannot be relaxed by a later meta element or script.
  return '<!doctype html><meta http-equiv="Content-Security-Policy" content="' + HTML_OUTPUT_CSP + '">' +
    FRAME_BOOTSTRAP + html;
}
