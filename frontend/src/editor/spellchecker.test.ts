/**
 * Loads the real bundled dictionaries through the same code path the app uses
 * (fetch of /dictionaries/<file>.aff and .dic) and checks that each language
 * accepts its own words and rejects nonsense. Guards the loader: the sliced
 * loading, the spell engine and the files shipped in public/dictionaries.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spellChecker } from './spellchecker';

const dictDir = fileURLToPath(new URL('../../public/dictionaries/', import.meta.url));

beforeAll(async () => {
  vi.stubGlobal('fetch', async (url: string) => {
    const name = String(url).replace('/dictionaries/', '');
    try {
      const text = readFileSync(dictDir + name, 'utf8');
      return { ok: true, text: async () => text };
    } catch {
      return { ok: false, text: async () => '' };
    }
  });
  await spellChecker.init();
}, 30000);

async function useLanguage(code: string) {
  spellChecker.setEnabledLanguages([code]);
  await spellChecker.loadLanguage(code);
}

describe('bundled dictionaries', () => {
  it('flags nothing until the chosen language has loaded', async () => {
    spellChecker.setEnabledLanguages(['es']);
    expect(spellChecker.check('zxqvt')).toBe(true);
    await spellChecker.loadLanguage('es');
    expect(spellChecker.check('zxqvt')).toBe(false);
  }, 30000);

  it('US English accepts color and rejects colour', async () => {
    await useLanguage('en_US');
    expect(spellChecker.check('color')).toBe(true);
    expect(spellChecker.check('colour')).toBe(false);
    expect(spellChecker.check('zxqvt')).toBe(false);
  });

  it('Canadian English accepts colour and contractions', async () => {
    await useLanguage('en_CA');
    expect(spellChecker.check('colour')).toBe(true);
    expect(spellChecker.check("doesn't")).toBe(true);
    expect(spellChecker.check('zxqvt')).toBe(false);
  });

  it('Spanish accepts Spanish words and rejects typos', async () => {
    await useLanguage('es');
    for (const w of ['hola', 'niño', 'español']) expect(spellChecker.check(w)).toBe(true);
    expect(spellChecker.check('holaa')).toBe(false);
  }, 30000);

  it('French accepts accents, affixes and apostrophes', async () => {
    await useLanguage('fr');
    for (const w of ['bonjour', 'été', "l'homme", "aujourd'hui", 'cinéma']) {
      expect(spellChecker.check(w)).toBe(true);
    }
    expect(spellChecker.check('bonjoir')).toBe(false);
  }, 30000);

  it('suggests the right correction', async () => {
    await useLanguage('fr');
    expect(spellChecker.suggest('bonjoir')).toContain('bonjour');
  }, 30000);
});
