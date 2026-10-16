/** Small helpers for working with file paths on any platform. */

function separatorFor(path: string): string {
  return path.includes('\\') && !path.includes('/') ? '\\' : '/';
}

export function joinPath(dir: string, name: string): string {
  return `${dir.replace(/[/\\]+$/, '')}${separatorFor(dir)}${name}`;
}

export function basenameOf(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() || path;
}

export function dirnameOf(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx > 0 ? path.slice(0, idx) : path;
}
