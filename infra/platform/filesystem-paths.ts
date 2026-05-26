export function normalizePath(path: string): string {
  if (!path) return '';

  let normalized = path.replace(/\\/g, '/');
  normalized = normalized.replace(/\/+/g, '/');

  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

export function joinPath(...parts: string[]): string {
  if (parts.length === 0) return '';
  return parts
    .filter((part) => part !== '')
    .join('/')
    .replace(/\/+/g, '/');
}

export function getBasename(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === '/' || normalized === '') return '';
  const parts = normalized.split('/');
  return parts[parts.length - 1] || '';
}

export function getDirname(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === '/' || normalized === '') return '/';
  const parts = normalized.split('/');
  parts.pop();
  return parts.join('/') || '/';
}
