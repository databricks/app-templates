interface BrowserRequestOrigin {
  origin?: string;
  appUrl?: string;
  fetchSite?: string;
}

// CORS protects response reads, not side effects. HTML frames must not act through
// the viewer's App session, including when an App endpoint accepts an empty body.
export function isSameOriginBrowserRequest({ origin, appUrl, fetchSite }: BrowserRequestOrigin): boolean {
  if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
  // Non-browser API clients do not send browser origin metadata; ingress authenticates them.
  if (origin === undefined) return true;
  if (origin === 'null' || appUrl === undefined) return false;
  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === origin &&
      url.origin === new URL(appUrl).origin
    );
  } catch {
    return false;
  }
}
