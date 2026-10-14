import { describe, it, expect } from 'vitest';
import { serializeWritea, parseWritea, WRITEA_VERSION } from './writeaFormat';
import { SAVE_METADATA_KEYS } from './saveContent';
import type { ScriptMeta } from '../services/api';

const META: ScriptMeta = {
  id: 's1', title: 'The Long Goodbye', author: 'Someone', format: 'json',
  created_at: '', updated_at: '', page_count: 42,
  size_bytes: 0, color: '#fff', pinned: false, sort_order: 0, preview: '',
} as ScriptMeta;

/** A payload carrying every `_`-prefixed key buildSaveContent writes. */
function fullContent(): Record<string, unknown> {
  const content: Record<string, unknown> = {
    type: 'doc',
    content: [{ type: 'action', content: [{ type: 'text', text: 'hello' }] }],
  };
  SAVE_METADATA_KEYS.forEach((key, i) => { content[key] = [`value-${i}`]; });
  return content;
}

describe('writea round-trip', () => {
  it('preserves every save-metadata key', () => {
    // The permanent guard for two bugs: a manual save dropping the
    // spelling/grammar keys, and an export writing bare editor JSON so
    // notes/tags/beats never came back.
    const content = fullContent();
    const parsed = parseWritea(serializeWritea(META, content));
    for (const key of SAVE_METADATA_KEYS) {
      expect(parsed.content[key], `${key} must survive the round-trip`).toEqual(content[key]);
    }
    expect(parsed.content.type).toBe('doc');
  });

  it('preserves script metadata and provenance', () => {
    const json = serializeWritea(META, fullContent(), {
      projectId: 'p1', scriptId: 's1', projectTitle: 'My Project', backupKind: 'manual',
    });
    const parsed = parseWritea(json);
    expect(parsed.meta.title).toBe('The Long Goodbye');
    expect(parsed.meta.page_count).toBe(42);
    expect(parsed.meta.project_id).toBe('p1');
    expect(parsed.meta.backup_kind).toBe('manual');
    expect(parsed.version).toBe(WRITEA_VERSION);
  });

  it('round-trips embedded assets', () => {
    const assets = [{ id: 'a1', filename: 'x.png', mime_type: 'image/png', data_base64: 'AAEC' }];
    const parsed = parseWritea(serializeWritea(META, fullContent(), { assets }));
    expect(parsed.assets).toEqual(assets);
  });

  it('omits the assets key entirely when there are none', () => {
    expect(serializeWritea(META, fullContent())).not.toContain('"assets"');
  });

  it('records when images were deliberately left out', () => {
    const parsed = parseWritea(serializeWritea(META, fullContent(), { assetsOmitted: true }));
    expect(parsed.meta.assets_omitted).toBe(true);
  });
});

describe('version and format checks', () => {
  it('writes the current version', () => {
    expect(JSON.parse(serializeWritea(META, fullContent())).writea_version).toBe(WRITEA_VERSION);
  });

  it('reads a minimal version 1 file', () => {
    const v1 = JSON.stringify({
      writea_version: 1,
      format: 'writea-script',
      exported_at: '2026-01-01T00:00:00.000Z',
      meta: { title: 'Small', author: 'A', color: '', page_count: 3 },
      content: { type: 'doc', content: [] },
    });
    const parsed = parseWritea(v1);
    expect(parsed.version).toBe(1);
    expect(parsed.meta.title).toBe('Small');
  });

  it('refuses a file from a newer WriTea Draft with a clear message', () => {
    const future = JSON.stringify({
      writea_version: WRITEA_VERSION + 1,
      format: 'writea-script',
      meta: {}, content: {},
    });
    expect(() => parseWritea(future)).toThrow(/newer version of WriTea Draft/);
  });

  it('rejects non-JSON and foreign JSON', () => {
    expect(() => parseWritea('not json')).toThrow(/not valid JSON/);
    expect(() => parseWritea('{"format":"something-else"}')).toThrow(/unrecognized format/);
    expect(() => parseWritea('null')).toThrow(/unrecognized format/);
  });

  it('rejects a bare editor payload with no envelope', () => {
    const bare = JSON.stringify({ type: 'doc', content: [], _notes: [{ id: 'n1' }] });
    expect(() => parseWritea(bare)).toThrow(/unrecognized format/);
  });

  it('rejects the retired envelope from the old native format', () => {
    const retired = JSON.stringify({
      odraft_version: 2,
      format: 'writeadraft-script',
      meta: {}, content: { type: 'doc', content: [] },
    });
    expect(() => parseWritea(retired)).toThrow(/unrecognized format/);
  });
});
