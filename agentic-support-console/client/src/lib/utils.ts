import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX32_RE = /^[0-9a-f]{32}$/i;

function hexToUuid(hex: string): string {
  const h = hex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Attempt to decode a base64-encoded 16-byte identifier (lakehouse BYTEA format)
 * into a standard UUID string. Returns null if the input isn't valid base64 or
 * doesn't decode to exactly 16 bytes.
 */
function base64ToUuid(b64: string): string | null {
  try {
    const binary = atob(b64);
    if (binary.length !== 16) return null;
    const hex = Array.from(binary, (ch) => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    return hexToUuid(hex);
  } catch {
    return null;
  }
}

/**
 * Normalise an identifier that may be a UUID, a 32-char hex UUID, or a
 * base64-encoded 16-byte lakehouse ID into a lowercase UUID string.
 * Returns null when the input can't be recognised as any of those formats.
 */
export function normaliseToUuid(input: string): string | null {
  const trimmed = input.trim();
  if (UUID_RE.test(trimmed)) return trimmed.toLowerCase();
  if (HEX32_RE.test(trimmed)) return hexToUuid(trimmed);
  return base64ToUuid(trimmed);
}
