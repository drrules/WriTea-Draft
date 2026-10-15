import type { StoredVersion } from '../stores/versionStore';

/** What a list of check-ins shows: no content, just which one it is. */
export interface VersionSummary {
  hash: string;
  short_hash: string;
  message: string;
  date: string;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: unknown): Promise<Uint8Array> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const piped = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as any);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Take a check-in of a script document. */
export async function createStoredVersion(doc: unknown, message: string, now: Date = new Date()): Promise<StoredVersion> {
  const json = JSON.stringify(doc ?? null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CS = (globalThis as any).CompressionStream;
  let format: StoredVersion['format'] = 'plain';
  let data = json;
  if (typeof CS === 'function') {
    try {
      data = toBase64(await pipe(new TextEncoder().encode(json), new CS('gzip')));
      format = 'gz';
    } catch {
      format = 'plain';
      data = json;
    }
  }
  return { id: newId(), message, date: now.toISOString(), format, data };
}

/** The script document a check-in holds. */
export async function readStoredVersion(v: StoredVersion): Promise<unknown> {
  if (v.format === 'plain') return JSON.parse(v.data);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const DS = (globalThis as any).DecompressionStream;
  if (typeof DS !== 'function') throw new Error('This device cannot unpack saved versions.');
  const bytes = await pipe(fromBase64(v.data), new DS('gzip'));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function toVersionSummary(v: StoredVersion): VersionSummary {
  return { hash: v.id, short_hash: v.id.slice(0, 7), message: v.message, date: v.date };
}

/** Newest first, as the history list shows them. */
export function summariesNewestFirst(versions: StoredVersion[]): VersionSummary[] {
  return versions.map(toVersionSummary).reverse();
}

/** Keep only well-formed entries from whatever a file held. */
export function sanitizeStoredVersions(raw: unknown): StoredVersion[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredVersion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.data !== 'string') continue;
    if (r.format !== 'gz' && r.format !== 'plain') continue;
    out.push({
      id: r.id,
      message: typeof r.message === 'string' ? r.message : '',
      date: typeof r.date === 'string' ? r.date : '',
      format: r.format,
      data: r.data,
    });
  }
  return out;
}

// ── Comparing two check-ins ────────────────────────────────────────────────

function textOf(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { text?: unknown; content?: unknown };
  if (typeof n.text === 'string') return n.text;
  return Array.isArray(n.content) ? n.content.map(textOf).join('') : '';
}

/** One line per paragraph of the script, empty ones left out. */
export function docLines(doc: unknown): string[] {
  const blocks = doc && typeof doc === 'object' && Array.isArray((doc as { content?: unknown }).content)
    ? (doc as { content: unknown[] }).content
    : [];
  return blocks.map(textOf).filter((l) => l.trim() !== '');
}

function lineDiff(a: string[], b: string[]): string[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const out: string[] = [];
  const n = midA.length;
  const m = midB.length;
  // Too big to match line by line: show the whole changed stretch.
  if (n * m > 4_000_000) {
    for (const l of midA) out.push(`-${l}`);
    for (const l of midB) out.push(`+${l}`);
    return out;
  }
  const w = m + 1;
  const t = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i * w + j] = midA[i] === midB[j]
        ? t[(i + 1) * w + j + 1] + 1
        : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) { i++; j++; }
    else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) out.push(`-${midA[i++]}`);
    else out.push(`+${midB[j++]}`);
  }
  while (i < n) out.push(`-${midA[i++]}`);
  while (j < m) out.push(`+${midB[j++]}`);
  return out;
}

/** The same text format the history screen already shows. */
export function diffDocs(from: unknown, to: unknown, title = 'Script'): string {
  const changes = lineDiff(docLines(from), docLines(to));
  if (changes.length === 0) return 'No differences found.';
  return [`--- ${title}`, `+++ ${title}`, '@@ modified @@', ...changes].join('\n');
}
