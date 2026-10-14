import { describe, it, expect } from 'vitest';
import { savedProfileFields } from './editorStore';

describe('savedProfileFields', () => {
  it('keeps every saved field when a script is opened', () => {
    const saved = JSON.parse(JSON.stringify({
      name: 'SARAH', description: 'A detective', color: '#8b5cf6', highlighted: true, gender: 'Female',
      age: '30s', role: 'Lead', backstory: '', arc: '', speechPattern: 'Clipped', vocabulary: '',
      verbalTics: '', sampleDialogue: '', images: ['a1'],
    }));
    const fields = savedProfileFields(saved);
    expect(fields.highlighted).toBe(true);
    expect(fields.images).toEqual(['a1']);
    expect(fields.speechPattern).toBe('Clipped');
  });

  it('defaults the text fields of an old profile to empty', () => {
    const f = savedProfileFields({ name: 'A', description: 5 });
    expect(f.description).toBe('');
    expect(f.highlighted).toBe(false);
    expect(f.images).toEqual([]);
  });
});
