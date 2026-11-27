export const R2_PUBLIC_CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400';

export function normalizeR2PublicBaseUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      return '';
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

export function getR2PublicBaseUrl(env = {}) {
  return normalizeR2PublicBaseUrl(env.R2_PUBLIC_BASE_URL);
}

export function getR2PublicUrl(env, objectKey, fallback = `/file/r2:${objectKey}`) {
  const baseUrl = getR2PublicBaseUrl(env);
  if (!baseUrl) return fallback;

  const encodedKey = String(objectKey || '')
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
  return encodedKey ? `${baseUrl}/${encodedKey}` : baseUrl;
}
