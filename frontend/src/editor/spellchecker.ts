// @ts-ignore nspell has no bundled type declarations
import nspell from 'nspell';
import { findLanguage, languageForLocale } from './languageCatalog';

/** Listener invoked when the dictionary contents change (project words, global
 *  library, enabled set, languages, add-targets). Triggers an editor rescan. */
type DictChangeListener = () => void;

/** The parts of an nspell engine this file uses. */
interface SpellEngine {
  correct(word: string): boolean;
  suggest(word: string): string[];
  dictionary(dic: string): unknown;
}

/** Word-list lines fed to the engine per step. Small enough that no single
 *  step visibly stalls the window; the largest bundled dictionary loads in
 *  about four seconds spread over many steps. */
const DIC_SLICE_LINES = 800;

/** Give the browser a turn to paint and handle input. */
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Special add-target id meaning "the project's private dictionary". */
export const PROJECT_DICT_TARGET = '__project__';

/** Base language. Always loaded first so the checker keeps working while any
 *  other enabled language is still loading. Bundled in /public/dictionaries/. */
export const BUILTIN_LANGUAGE = 'en_US';

/** App-wide choice of spell-check languages (not stored per script). */
const ENABLED_LANGS_KEY = 'writeadraft:enabledLanguages';

function readStoredLanguages(): string[] | null {
  try {
    const raw = localStorage.getItem(ENABLED_LANGS_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    const codes = arr.filter((c): c is string => typeof c === 'string' && !!findLanguage(c));
    return codes.length > 0 ? codes : null;
  } catch {
    return null;
  }
}

/** Remember the user's language choice for the whole app. */
export function saveEnabledLanguagePreference(codes: string[]): void {
  try {
    localStorage.setItem(ENABLED_LANGS_KEY, JSON.stringify(codes));
  } catch { /* noop */ }
}

/** Default when nothing is saved yet: the system language, if bundled. */
function systemDefaultLanguages(): string[] {
  const tag = typeof navigator !== 'undefined' ? navigator.language : undefined;
  return [languageForLocale(tag)];
}

class SpellChecker {
  /** Hunspell engines keyed by language code (e.g. "en_US", "fr"). */
  private typos: Map<string, SpellEngine> = new Map();
  /** Labels captured for each loaded language (display only). */
  private labels: Map<string, string> = new Map();
  /** Languages currently used for checking (app-wide). */
  private enabledLanguages: Set<string> = new Set([BUILTIN_LANGUAGE]);

  /** Words the user added via "Add to dictionary", saved with the script. */
  private projectWords: Set<string> = new Set();
  /** When false, project words are skipped during checks (per-script toggle). */
  private projectDictionaryEnabled: boolean = true;

  /** Global named dictionaries (e.g. "Personal", "Sci-Fi"). Shared across projects, lives in localStorage. */
  private globalDicts: Map<string, Set<string>> = new Map();
  /** Names of global dictionaries the current project has enabled. */
  private enabledGlobalDicts: Set<string> = new Set();

  /** Dictionaries that the "Add to Dictionary" action writes to. Members are
   *  either PROJECT_DICT_TARGET or a global-dict name. Global setting. */
  private addTargets: Set<string> = new Set([PROJECT_DICT_TARGET]);

  private ignoreWords: Set<string> = new Set(); // ignore all occurrences (per-document)
  private ignoredOnce: Set<string> = new Set(); // ignore specific occurrences (per-document)

  /** True once the built-in language is loaded. */
  private ready = false;
  private initPromise: Promise<void> | null = null;
  /** Per-language load promises (de-dupes concurrent loadLanguage calls). */
  private loadPromises: Map<string, Promise<boolean>> = new Map();
  private listeners: Set<DictChangeListener> = new Set();

  async init(): Promise<void> {
    if (this.ready) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInit();
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    const ok = await this.loadLanguage(BUILTIN_LANGUAGE);
    if (!ok) {
      console.error('SpellChecker: failed to load built-in language', BUILTIN_LANGUAGE);
      return;
    }
    this.ready = true;
    // Apply the app-wide language choice (the system language by default).
    // Any language other than the built-in one starts loading here.
    this.setEnabledLanguages(readStoredLanguages() ?? systemDefaultLanguages());
  }

  /** Wait for initialization to complete (if in progress). */
  async whenReady(): Promise<boolean> {
    if (this.ready) return true;
    if (this.initPromise) {
      await this.initPromise;
    }
    return this.ready;
  }

  isReady(): boolean {
    return this.ready;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Language loading

  /** Load a bundled language from /dictionaries/<file>.aff and .dic. */
  async loadLanguage(code: string): Promise<boolean> {
    if (this.typos.has(code)) return true;
    const existing = this.loadPromises.get(code);
    if (existing) return existing;
    const p = this._doLoadLanguage(code);
    this.loadPromises.set(code, p);
    try {
      return await p;
    } finally {
      this.loadPromises.delete(code);
    }
  }

  private async _doLoadLanguage(code: string): Promise<boolean> {
    const lang = findLanguage(code);
    if (!lang) {
      console.warn('SpellChecker: unknown language', code);
      return false;
    }
    try {
      let [aff, dic] = await Promise.all([
        fetch(`/dictionaries/${lang.file}.aff`).then((r) => (r.ok ? r.text() : null)),
        fetch(`/dictionaries/${lang.file}.dic`).then((r) => (r.ok ? r.text() : null)),
      ]);
      if (!aff || !dic) {
        console.error('SpellChecker: bundled files missing for', code);
        return false;
      }
      // Strip a UTF-8 BOM if one is present.
      if (aff.charCodeAt(0) === 0xfeff) aff = aff.slice(1);
      if (dic.charCodeAt(0) === 0xfeff) dic = dic.slice(1);
      // Sanity check: the .aff needs a SET line near the top and the .dic
      // must start with its word count. Catches an HTML error page being
      // served in place of the file.
      const affHead = aff.split(/\r?\n/, 30).join('\n');
      if (!/(^|\n)SET\s/.test(affHead) || !/^\d+/.test(dic.trimStart())) {
        console.error('SpellChecker: bundled data looks invalid for', code);
        return false;
      }
      // Build the engine from the affix rules, then add the word list in
      // slices so the window stays responsive while a large language loads.
      // Drop the COMPOUNDRULE lines: nspell builds those from the whole word
      // list, so when the list arrives in slices they accept every word. They
      // only exist to accept number forms such as "21st".
      const affRules = aff
        .split(/\r?\n/)
        .filter((l) => !/^COMPOUNDRULE\b/.test(l))
        .join('\n');
      const engine = nspell(affRules) as SpellEngine;
      const lines = dic.split(/\r?\n/);
      for (let i = 1; i < lines.length; i += DIC_SLICE_LINES) {
        // Each slice gets a dummy count line; nspell skips the first line.
        engine.dictionary('0\n' + lines.slice(i, i + DIC_SLICE_LINES).join('\n'));
        await yieldToUi();
      }
      this.typos.set(code, engine);
      this.labels.set(code, lang.label);
      this.emitChange();
      return true;
    } catch (err) {
      console.error('SpellChecker: failed to load', code, err);
      return false;
    }
  }

  getLoadedLanguages(): { code: string; label: string }[] {
    return [...this.typos.keys()].sort().map((code) => ({
      code,
      label: this.labels.get(code) || code,
    }));
  }

  getEnabledLanguages(): string[] {
    return [...this.enabledLanguages].sort();
  }

  setEnabledLanguages(codes: string[]): void {
    this.enabledLanguages.clear();
    for (const c of codes) {
      if (findLanguage(c)) this.enabledLanguages.add(c);
    }
    if (this.enabledLanguages.size === 0) {
      for (const c of systemDefaultLanguages()) this.enabledLanguages.add(c);
    }
    // Start loading any enabled language that is not loaded yet. A change
    // event fires as each one arrives, which rescans the document.
    if (this.ready) {
      for (const c of this.enabledLanguages) {
        if (!this.typos.has(c)) void this.loadLanguage(c);
      }
    }
    this.emitChange();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Checking

  check(word: string): boolean {
    // Normalize curly apostrophes to straight so contractions like "doesn't"
    // typed with smart quotes match Hunspell's dictionary entries.
    const normalized = word.replace(/[‘’]/g, "'");
    const lower = normalized.toLowerCase();

    if (this.projectDictionaryEnabled && this.projectWords.has(lower)) return true;
    if (this.ignoreWords.has(lower)) return true;
    for (const name of this.enabledGlobalDicts) {
      const dict = this.globalDicts.get(name);
      if (dict && dict.has(lower)) return true;
    }
    let anyLoaded = false;
    for (const code of this.enabledLanguages) {
      const typo = this.typos.get(code);
      if (!typo) continue;
      anyLoaded = true;
      if (typo.correct(normalized)) return true;
    }
    // No enabled language has finished loading yet (still booting): don't flag.
    if (!anyLoaded) return true;
    return false;
  }

  /** Check if a specific occurrence is ignored via "Ignore Once". */
  isIgnoredOnce(word: string, contextKey: string): boolean {
    return this.ignoredOnce.has(`${word.toLowerCase()}|${contextKey}`);
  }

  suggest(word: string): string[] {
    // Aggregate suggestions across all enabled languages, preserving order
    // (enabled-language order) and de-duplicating.
    const out: string[] = [];
    const seen = new Set<string>();
    for (const code of this.enabledLanguages) {
      const typo = this.typos.get(code);
      if (!typo) continue;
      const s = typo.suggest(word).slice(0, 5);
      for (const w of s) {
        if (seen.has(w)) continue;
        seen.add(w);
        out.push(w);
        if (out.length >= 5) return out;
      }
    }
    return out;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Project dictionary

  /** Add a word to the current project's private dictionary. */
  addToProjectDictionary(word: string): void {
    this.projectWords.add(word.toLowerCase());
    this.emitChange();
  }

  /** Remove a word from the current project's private dictionary. */
  removeFromProjectDictionary(word: string): void {
    if (this.projectWords.delete(word.toLowerCase())) {
      this.emitChange();
    }
  }

  /** Return project private dictionary words (for persisting with the document). */
  getProjectWords(): string[] {
    return [...this.projectWords].sort();
  }

  /** Bulk-load project private words (when opening a document). */
  setProjectWords(words: string[]): void {
    this.projectWords.clear();
    for (const w of words) this.projectWords.add(w.toLowerCase());
    this.emitChange();
  }

  /** Whether the project dictionary is consulted during checks. */
  isProjectDictionaryEnabled(): boolean {
    return this.projectDictionaryEnabled;
  }

  setProjectDictionaryEnabled(enabled: boolean): void {
    if (this.projectDictionaryEnabled === enabled) return;
    this.projectDictionaryEnabled = enabled;
    this.emitChange();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Global dictionaries

  /** Names of global dictionaries currently enabled for the active project. */
  getEnabledGlobalDicts(): string[] {
    return [...this.enabledGlobalDicts].sort();
  }

  /** Bulk-set the enabled global dictionaries for the active project. */
  setEnabledGlobalDicts(names: string[]): void {
    this.enabledGlobalDicts.clear();
    for (const n of names) this.enabledGlobalDicts.add(n);
    this.emitChange();
  }

  /** Replace the global dictionary library (called by the store on any library change). */
  setGlobalDictionaries(dicts: Record<string, readonly string[]>): void {
    this.globalDicts.clear();
    for (const [name, words] of Object.entries(dicts)) {
      this.globalDicts.set(name, new Set(words.map((w) => w.toLowerCase())));
    }
    this.emitChange();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Add-to-Dictionary targets (global setting)

  /** Dictionaries that "Add to Dictionary" writes to. */
  getAddTargets(): string[] {
    return [...this.addTargets].sort();
  }

  setAddTargets(targets: string[]): void {
    this.addTargets.clear();
    for (const t of targets) this.addTargets.add(t);
    this.emitChange();
  }

  /** Returns the list of add-targets that are usable *right now* for this
   *  project, in a stable order: project (if enabled) first, then enabled
   *  global dictionaries alphabetically. Filters out globals that aren't
   *  enabled for this project so the menu doesn't offer dead targets. */
  getActiveAddTargets(): string[] {
    const out: string[] = [];
    if (this.addTargets.has(PROJECT_DICT_TARGET) && this.projectDictionaryEnabled) {
      out.push(PROJECT_DICT_TARGET);
    }
    const globalNames = [...this.addTargets]
      .filter((t) => t !== PROJECT_DICT_TARGET)
      .filter((name) => this.globalDicts.has(name))
      .sort();
    out.push(...globalNames);
    return out;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Change notifications

  /** Subscribe to dictionary-content changes. Returns an unsubscribe fn. */
  onChange(listener: DictChangeListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emitChange(): void {
    for (const fn of this.listeners) {
      try { fn(); } catch (err) { console.warn('SpellChecker listener threw', err); }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Ignore (per-document)

  /** Ignore all occurrences of a word in this document. */
  ignoreWord(word: string): void {
    this.ignoreWords.add(word.toLowerCase());
  }

  /** Ignore a specific occurrence of a word (identified by surrounding context). */
  ignoreOnce(word: string, contextKey: string): void {
    this.ignoredOnce.add(`${word.toLowerCase()}|${contextKey}`);
  }

  getIgnoredWords(): string[] {
    return [...this.ignoreWords];
  }

  setIgnoredWords(words: string[]): void {
    this.ignoreWords.clear();
    for (const w of words) {
      this.ignoreWords.add(w.toLowerCase());
    }
  }

  getIgnoredOnce(): string[] {
    return [...this.ignoredOnce];
  }

  setIgnoredOnce(entries: string[]): void {
    this.ignoredOnce.clear();
    for (const e of entries) {
      this.ignoredOnce.add(e);
    }
  }

  /**
   * Build a context key for a word occurrence.
   * Uses up to 20 chars before + 20 chars after the word within the text node.
   */
  static buildContextKey(text: string, matchIndex: number, wordLength: number): string {
    const before = text.slice(Math.max(0, matchIndex - 20), matchIndex);
    const after = text.slice(matchIndex + wordLength, matchIndex + wordLength + 20);
    return `${before}>><<${after}`;
  }

  /** Collect all misspelled words with their positions from a ProseMirror doc.
   *  @param flagProperNouns When false (default), capitalized unknown words are
   *  treated as proper nouns and skipped. When true, they are flagged. */
  findAllErrors(
    doc: import('@tiptap/pm/state').EditorState['doc'],
    flagProperNouns: boolean = false,
  ): { word: string; from: number; to: number; context: string; contextKey: string }[] {
    const errors: { word: string; from: number; to: number; context: string; contextKey: string }[] = [];
    doc.descendants((node, pos) => {
      if (!node.isText) return;
      const text = node.text || '';
      // Unicode-aware tokenizer: matches any letter (incl. Devanagari, CJK,
      // Cyrillic, etc.) optionally followed by combining marks, plus straight
      // and curly apostrophes for contractions.
      const wordRegex = /[\p{L}\p{M}'‘’]+/gu;
      let match: RegExpExecArray | null;
      while ((match = wordRegex.exec(text)) !== null) {
        const word = match[0];
        if (word.length < 2) continue;
        // Skip ACRONYMS, but only for cased scripts (see SpellCheck.ts).
        if (
          word === word.toUpperCase() &&
          word !== word.toLowerCase() &&
          word.length > 1
        ) continue;
        if (!this.check(word)) {
          if (!flagProperNouns && /^\p{Lu}/u.test(word)) continue;
          const contextKey = SpellChecker.buildContextKey(text, match.index, word.length);
          // Skip if this specific occurrence was ignored via "Ignore Once"
          if (this.isIgnoredOnce(word, contextKey)) continue;
          const from = pos + match.index;
          const to = from + word.length;
          // Build context: up to 30 chars around the word
          const ctxStart = Math.max(0, match.index - 15);
          const ctxEnd = Math.min(text.length, match.index + word.length + 15);
          const context = (ctxStart > 0 ? '...' : '') + text.slice(ctxStart, ctxEnd) + (ctxEnd < text.length ? '...' : '');
          errors.push({ word, from, to, context, contextKey });
        }
      }
    });
    return errors;
  }
}

export const spellChecker = new SpellChecker();
