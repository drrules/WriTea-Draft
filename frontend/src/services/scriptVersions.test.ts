import { describe, it, expect } from 'vitest';
import {
  createStoredVersion, readStoredVersion, toVersionSummary, summariesNewestFirst,
  sanitizeStoredVersions, docLines, diffDocs,
} from './scriptVersions';

const para = (text: string) => ({ type: 'action', content: [{ type: 'text', text }] });
const doc = (...lines: string[]) => ({ type: 'doc', content: lines.map(para) });

describe('script versions', () => {
  it('round trips a script through a check-in', async () => {
    const d = doc('INT. KITCHEN - DAY', 'She waits.');
    const v = await createStoredVersion(d, 'First draft', new Date('2026-10-15T12:00:00Z'));
    expect(v.message).toBe('First draft');
    expect(v.date).toBe('2026-10-15T12:00:00.000Z');
    expect(await readStoredVersion(v)).toEqual(d);
  });

  it('reads a plain (uncompressed) check-in too', async () => {
    const d = doc('One.');
    expect(await readStoredVersion({ id: 'x', message: '', date: '', format: 'plain', data: JSON.stringify(d) })).toEqual(d);
  });

  it('summarises and lists newest first', async () => {
    const a = await createStoredVersion(doc('a'), 'one');
    const b = await createStoredVersion(doc('b'), 'two');
    expect(toVersionSummary(a)).toEqual({ hash: a.id, short_hash: a.id.slice(0, 7), message: 'one', date: a.date });
    expect(summariesNewestFirst([a, b]).map((s) => s.message)).toEqual(['two', 'one']);
  });

  it('drops malformed entries when a file is read', () => {
    const good = { id: 'a', message: 'm', date: 'd', format: 'gz', data: 'xx' };
    expect(sanitizeStoredVersions([good, null, { id: 'b' }, { ...good, format: 'zip' }, 'junk'])).toEqual([good]);
    expect(sanitizeStoredVersions('nope')).toEqual([]);
  });

  it('lists a script as one line per paragraph', () => {
    expect(docLines(doc('One.', '', 'Two.'))).toEqual(['One.', 'Two.']);
  });

  it('shows only the changed paragraphs', () => {
    const out = diffDocs(doc('a', 'b', 'c'), doc('a', 'b2', 'c'));
    expect(out).toContain('@@ modified @@');
    expect(out).toContain('-b\n+b2');
    expect(out).not.toContain('-a');
    expect(out).not.toContain('-c');
  });

  it('reports no differences', () => {
    expect(diffDocs(doc('a'), doc('a'))).toBe('No differences found.');
  });
});
