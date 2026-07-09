const PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_ABSOLUTE_RE = /^[a-z]:[\\/]/i;

export function publicAssetUrl(path: string): string;
export function publicAssetUrl(path: string | null | undefined): string | null;
export function publicAssetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  let trimmed = path.trim();
  if (!trimmed) return null;
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  if (!trimmed) return null;
  if (WINDOWS_ABSOLUTE_RE.test(trimmed)) return `file:///${trimmed.replace(/\\/g, '/')}`;
  if (PROTOCOL_RE.test(trimmed) || trimmed.startsWith('//')) return trimmed;
  if (trimmed.startsWith('./') || trimmed.startsWith('../')) return trimmed;

  const base = import.meta.env.BASE_URL || './';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${trimmed.replace(/^\/+/, '')}`;
}
