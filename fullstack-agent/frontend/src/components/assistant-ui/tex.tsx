import "katex/dist/katex.min.css";
import "./tex.css";
import katex from "katex";

// KaTeX settings: trust: false blocks URL loading, maxSize limits spacing, errors render as red text.
const KATEX_OPTIONS = { trust: false, maxSize: 2, maxExpand: 100, strict: "ignore", throwOnError: false } as const;

function TexHtml({ tex, display }: { tex: string; display: boolean }) {
  const html = katex.renderToString(tex, { ...KATEX_OPTIONS, displayMode: display });
  return <span className="aui-tex" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function InlineTex({ tex }: { tex: string }) {
  return <TexHtml tex={tex} display={false} />;
}

export function DisplayTex({ tex }: { tex: string }) {
  return (
    <div className="my-3">
      <TexHtml tex={tex} display />
    </div>
  );
}
