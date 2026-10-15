import { describe, it, expect } from 'vitest';
import { writeaOnlyContent } from './writeaOnly';

describe('writeaOnlyContent', () => {
  it('is empty for a plain script', () => {
    expect(writeaOnlyContent({ type: 'doc', content: [] })).toEqual([]);
    expect(writeaOnlyContent(null)).toEqual([]);
  });

  it('flags assets', () => {
    expect(writeaOnlyContent({ _assets: [{ id: 'abc' }] })).toContain('pictures and assets');
  });

  it('flags character relationships', () => {
    expect(writeaOnlyContent({ '_characterRelationships': [{ id: 'r1' }] })).toContain('character relationships');
  });

  it('flags version history', () => {
    expect(writeaOnlyContent({ _versions: [{ id: 'v1' }] })).toContain('version history');
    expect(writeaOnlyContent({ _versions: [] })).toEqual([]);
  });
});
