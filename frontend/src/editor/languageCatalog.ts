/** Spell-check languages bundled inside the app. Each one is a Hunspell
 *  .aff/.dic pair under public/dictionaries/, loaded on demand when it is
 *  enabled. Nothing is ever downloaded. The licence notice for each
 *  dictionary sits beside its files as <file>.LICENSE.txt. */

export interface BundledLanguage {
  /** Internal code (becomes the spell-checker language id). */
  code: string;
  /** User-facing label. */
  label: string;
  /** Basename of the .aff/.dic pair under /dictionaries/. */
  file: string;
  /** Short alphabet sample for the picker. */
  sample?: string;
}

export const BUNDLED_LANGUAGES: BundledLanguage[] = [
  { code: 'en_CA', label: 'Canadian English', file: 'en_CA', sample: 'Aa' },
  { code: 'en_US', label: 'US English', file: 'en_US', sample: 'Aa' },
  { code: 'fr', label: 'French', file: 'fr', sample: 'Àà' },
  { code: 'es', label: 'Spanish', file: 'es_ES', sample: 'Ññ' },
];

/** Always loaded first, so the checker has a working language while any
 *  other enabled language is still loading. */
export const BUILTIN: BundledLanguage = BUNDLED_LANGUAGES.find((l) => l.code === 'en_US')!;

const BY_CODE = new Map<string, BundledLanguage>(
  BUNDLED_LANGUAGES.map((l) => [l.code, l]),
);

export function findLanguage(code: string): BundledLanguage | undefined {
  return BY_CODE.get(code);
}

/** Pick the bundled language that best matches a system locale tag such as
 *  "en-CA" or "fr_FR". Anything unrecognised falls back to English (US). */
export function languageForLocale(tag: string | null | undefined): string {
  const t = (tag || '').toLowerCase().replace('_', '-');
  if (t === 'en-ca') return 'en_CA';
  if (t === 'fr' || t.startsWith('fr-')) return 'fr';
  if (t === 'es' || t.startsWith('es-')) return 'es';
  return 'en_US';
}
