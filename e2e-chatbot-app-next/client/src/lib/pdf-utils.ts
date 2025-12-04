/**
 * Utilities for parsing and handling Unity Catalog PDF links.
 */

export interface UCPDFMetadata {
  filename: string;
  volumePath: string;
  page?: number;
  textFragment?: string;
  /** URL to fetch/download the PDF through our backend proxy */
  downloadUrl: string;
  /** Original Databricks URL (for reference/debugging) */
  originalUrl: string;
}

/**
 * Parse a Unity Catalog PDF link and extract metadata.
 *
 * Expected URL format: /ajax-api/2.0/fs/files/Volumes/{catalog}/{schema}/{volume}/{filename}.pdf
 * Optional hash: #page=N:~:text=encoded_text or #:~:text=encoded_text or #page=N
 */
export function parseUnityCatalogPDFLink(href: string): UCPDFMetadata | null {
  try {
    const urlObject = new URL(href, window.location.origin);
    const pathname = decodeURIComponent(urlObject.pathname);

    const regex =
      /^\/ajax-api\/2\.0\/fs\/files\/(Volumes\/[^/]+\/[^/]+\/[^/]+)\/(.+\.pdf)$/i;
    const match = pathname.match(regex);

    if (match) {
      let page: number | undefined = undefined;
      let textFragment: string | undefined = undefined;

      // Check if page is in query params (legacy format)
      const pageParam = urlObject.searchParams.get('page');
      if (pageParam) {
        const parsedPage = Number.parseInt(pageParam, 10);
        page = !Number.isNaN(parsedPage) ? parsedPage : undefined;
      }

      // Check if hash contains page and/or text fragment (new format)
      // Hash can be: #page=5:~:text=cited%20text or just #:~:text=cited%20text or #page=5
      if (urlObject.hash) {
        const hash = urlObject.hash.substring(1); // Remove the '#' prefix

        // Check for page in hash (format: page=5:~:text=... or page=5)
        const hashPageMatch = hash.match(/^page=(\d+)/);
        if (hashPageMatch) {
          const parsedPage = Number.parseInt(hashPageMatch[1], 10);
          page = !Number.isNaN(parsedPage) ? parsedPage : page;
        }

        // Check for text fragment in hash (format: :~:text=...)
        const textFragmentMatch = hash.match(/:~:text=(.+)$/);
        if (textFragmentMatch) {
          textFragment = decodeURIComponent(textFragmentMatch[1]);
        } else if (hash.startsWith(':~:text=')) {
          // Handle case where hash only contains text fragment without page
          textFragment = decodeURIComponent(hash.substring(':~:text='.length));
        }
      }

      // Create the proxy URL that goes through our backend
      // The backend will authenticate with Databricks and fetch the file
      const volumePathWithFilename = `${match[1]}/${match[2]}`;
      const proxyUrl = `/api/files/volumes/${volumePathWithFilename}`;

      // Keep the original URL for reference (e.g., for "Open in Catalog" link)
      const originalUrl = new URL(href, window.location.origin);
      originalUrl.searchParams.delete('page');

      return {
        volumePath: match[1],
        filename: match[2],
        page,
        textFragment,
        downloadUrl: proxyUrl,
        originalUrl: originalUrl.toString(),
      };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Check if a URL is a Unity Catalog PDF link.
 */
export function isUnityCatalogPDFLink(href: string): boolean {
  return parseUnityCatalogPDFLink(href) !== null;
}

/**
 * Generate Unity Catalog explorer URL for a file.
 */
export function getUnityCatalogExplorerUrl(
  volumePath: string,
  filename: string,
): string {
  if (!filename || !volumePath) {
    return '';
  }
  // UC expects the filePreviewPath to be encoded
  return `/explore/data/${volumePath}?filePreviewPath=${encodeURIComponent(filename)}`;
}
