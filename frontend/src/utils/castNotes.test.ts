import { describe, it, expect } from 'vitest';
import { foldCastDescription, splitCastDescription } from './castNotes';

const plain = (h: string) => h.replace(/<[^>]+>/g, '');

describe('cast notes', () => {
  it('leaves a plain description exactly as it was', () => {
    expect(foldCastDescription({ description: '<p>A tired detective.</p>' }, plain)).toBe('A tired detective.');
    expect(splitCastDescription('A tired detective.')).toEqual({ description: 'A tired detective.' });
  });

  it('round trips the extra fields', () => {
    const folded = foldCastDescription(
      { description: '<p>Hero</p>', gender: 'F', age: '40', backstory: '<p>Grew up here</p>', verbalTics: 'um' },
      plain,
    );
    expect(folded).toContain('[WriTea: Backstory]');
    expect(splitCastDescription(folded)).toEqual({
      description: 'Hero', gender: 'F', age: '40', backstory: 'Grew up here', verbalTics: 'um',
    });
  });

  it('keeps text under an unknown label in the description', () => {
    const out = splitCastDescription('Hello\n\n[WriTea: Mood]\nsad');
    expect(out.description).toBe('Hello\n\n[WriTea: Mood]\nsad');
  });

  it('keeps everything when a block is repeated', () => {
    const out = splitCastDescription('[WriTea: Arc]\none\n\n[WriTea: Arc]\ntwo');
    expect(out.arc).toBe('one\n\ntwo');
  });
});
