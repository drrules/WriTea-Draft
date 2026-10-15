import type { CharacterProfile } from '../stores/editorStore';

/**
 * Character details Final Draft has no field for, carried inside the cast
 * list's Description as labelled blocks:
 *
 *   A tired detective.
 *
 *   [WriTea: Backstory]
 *   Grew up on the wrong side of the river.
 *
 * Opened in Final Draft it reads as an ordinary bio. Opened here, each block
 * goes back to its own field. Text under a label we do not recognise stays in
 * the description, so an edit made elsewhere can never lose words.
 */
type Folded = Pick<
  CharacterProfile,
  'gender' | 'age' | 'role' | 'backstory' | 'arc' | 'speechPattern' | 'vocabulary' | 'verbalTics' | 'sampleDialogue'
>;

const SECTIONS: ReadonlyArray<{ key: keyof Folded; label: string }> = [
  { key: 'gender', label: 'Gender' },
  { key: 'age', label: 'Age' },
  { key: 'role', label: 'Role' },
  { key: 'backstory', label: 'Backstory' },
  { key: 'arc', label: 'Arc' },
  { key: 'speechPattern', label: 'Speech Patterns' },
  { key: 'vocabulary', label: 'Vocabulary' },
  { key: 'verbalTics', label: 'Verbal Tics' },
  { key: 'sampleDialogue', label: 'Sample Lines' },
];

const TAG_LINE = /^\s*\[WriTea:\s*([^\]]+?)\s*\]\s*$/i;

/** The plain-text Description Final Draft stores for a character. */
export function foldCastDescription(
  p: Partial<CharacterProfile>,
  toPlain: (html: string) => string,
): string {
  const parts: string[] = [];
  const main = toPlain(p.description ?? '').trim();
  if (main) parts.push(main);
  for (const { key, label } of SECTIONS) {
    const text = toPlain(String(p[key] ?? '')).trim();
    if (text) parts.push(`[WriTea: ${label}]\n${text}`);
  }
  return parts.join('\n\n');
}

/** The reverse: a cast-list Description back into profile fields. */
export function splitCastDescription(text: string): { description: string } & Partial<Folded> {
  const buckets: Array<{ key: keyof Folded | null; lines: string[] }> = [{ key: null, lines: [] }];
  let current = buckets[0];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = TAG_LINE.exec(line);
    const section = m ? SECTIONS.find((s) => s.label.toLowerCase() === m[1].toLowerCase()) : undefined;
    if (section) {
      current = { key: section.key, lines: [] };
      buckets.push(current);
    } else {
      current.lines.push(line);
    }
  }
  const out: { description: string } & Partial<Folded> = {
    description: buckets[0].lines.join('\n').trim(),
  };
  for (const b of buckets.slice(1)) {
    const value = b.lines.join('\n').trim();
    if (!value || !b.key) continue;
    out[b.key] = out[b.key] ? `${out[b.key]}\n\n${value}` : value;
  }
  return out;
}
