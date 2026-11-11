import { type SyntheticEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { isRecord } from '../../server/plugins/designer/client';
import { HTML_OUTPUT_WRAPPER_CSP, HTML_OUTPUT_WRAPPER_DOCUMENT, htmlOutputDocument } from './htmlSandbox';

export interface OutputHtmlProps {
  html: string;
  title: string;
}

export function OutputHtml({ html, title }: OutputHtmlProps) {
  return <HtmlDocument key={html} html={html} title={title} />;
}

function HtmlDocument({ html, title }: OutputHtmlProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(320);
  const [errors, setErrors] = useState<string[]>([]);
  const [wrapperDocument, setWrapperDocument] = useState<Document | null>(null);
  const source = useMemo(() => htmlOutputDocument(html), [html]);

  const handleWrapperLoad = (event: SyntheticEvent<HTMLIFrameElement>) => {
    setHeight(320);
    setErrors([]);
    const document = event.currentTarget.contentDocument;
    const policy = document?.querySelector('meta[http-equiv="Content-Security-Policy"]');
    // An initial blank document or an unexpected reload must never host author content.
    if (!document?.body || !document.defaultView || policy?.getAttribute('content') !== HTML_OUTPUT_WRAPPER_CSP) {
      setWrapperDocument(null);
      return;
    }
    document.documentElement.style.height = '100%';
    Object.assign(document.body.style, { height: '100%', margin: '0', overflow: 'hidden' });
    setWrapperDocument(document);
  };

  useLayoutEffect(() => {
    if (!wrapperDocument?.defaultView) return;
    const wrapperWindow = wrapperDocument.defaultView;
    const reportError = (message: string) => {
      setErrors((previous) => (previous.length >= 5 || previous.includes(message) ? previous : [...previous, message]));
    };
    const receive = (event: MessageEvent<unknown>) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== 'null' ||
        !isRecord(event.data) ||
        event.data.type !== 'designer-html'
      )
        return;
      if (typeof event.data.height === 'number' && Number.isFinite(event.data.height)) {
        setHeight(Math.max(160, Math.min(1600, event.data.height)));
      }
      if (typeof event.data.error === 'string') {
        reportError(event.data.error.slice(0, 2000));
      }
    };
    const reportNavigationViolation = (event: SecurityPolicyViolationEvent) => {
      if (event.effectiveDirective === 'frame-src') {
        reportError('The HTML output security policy blocked navigation. External navigation is disabled.');
      }
    };
    wrapperWindow.addEventListener('message', receive);
    wrapperDocument.addEventListener('securitypolicyviolation', reportNavigationViolation);
    return () => {
      wrapperWindow.removeEventListener('message', receive);
      wrapperDocument.removeEventListener('securitypolicyviolation', reportNavigationViolation);
    };
  }, [source, wrapperDocument]);

  return (
    <div className="px-6 py-4">
      {errors.length > 0 && (
        <div role="alert" className="text-destructive mb-3 whitespace-pre-wrap text-sm">
          {errors.join('\n')}
        </div>
      )}
      {/* Remove the sandbox before its containing document during unmount. */}
      {wrapperDocument &&
        createPortal(
          <iframe
            key={source}
            ref={frame}
            title={`${title} content`}
            srcDoc={source}
            sandbox="allow-scripts"
            allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'"
            referrerPolicy="no-referrer"
            style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
          />,
          wrapperDocument.body
        )}
      <iframe
        title={title}
        srcDoc={HTML_OUTPUT_WRAPPER_DOCUMENT}
        onLoad={handleWrapperLoad}
        referrerPolicy="no-referrer"
        className="w-full border-0"
        style={{ height }}
      />
    </div>
  );
}
