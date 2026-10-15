import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { htmlOutputDocument } from './htmlSandbox';

export interface OutputHtmlProps {
  html: string;
  title: string;
}

export function OutputHtml({ html, title }: OutputHtmlProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(320);
  const [errors, setErrors] = useState<string[]>([]);
  const source = useMemo(() => htmlOutputDocument(html), [html]);

  useLayoutEffect(() => {
    setHeight(320);
    setErrors([]);
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== 'designer-html') return;
      if (typeof event.data.height === 'number' && Number.isFinite(event.data.height)) {
        setHeight(Math.max(160, Math.min(1600, event.data.height)));
      }
      if (typeof event.data.error === 'string') {
        const message = event.data.error.slice(0, 2000);
        setErrors((previous) => previous.length >= 5 || previous.includes(message) ? previous : [...previous, message]);
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [source]);

  return (
    <div className="px-6 py-4">
      {errors.length > 0 && (
        <div role="alert" className="text-destructive mb-3 whitespace-pre-wrap text-sm">{errors.join('\n')}</div>
      )}
      <iframe
        ref={frame}
        title={title}
        srcDoc={source}
        sandbox="allow-scripts"
        allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'"
        referrerPolicy="no-referrer"
        className="w-full border-0"
        style={{ height }}
      />
    </div>
  );
}
