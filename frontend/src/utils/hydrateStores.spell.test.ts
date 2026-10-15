import { describe, it, expect } from 'vitest';
import { hydrateEditorStoresFromContent } from './hydrateStores';
import { buildSaveContent } from './saveContent';
import { spellChecker } from '../editor/spellchecker';
import { grammarIgnore } from '../editor/grammar/grammarIgnore';
import { useEditorStore } from '../stores/editorStore';

const DOC = { type: 'doc', content: [] };

describe('spell and grammar state travels with the file', () => {
  it('restores dictionary words, ignore lists and toggles from a file', () => {
    const ok = hydrateEditorStoresFromContent({
      ...DOC,
      _customDictWords: ['zorp', 'blarg'],
      _ignoredWords: ['quux'],
      _projectDictEnabled: false,
      _ignoredGrammarRules: ['RULE_ONE'],
      _grammarCheckEnabled: true,
    });
    expect(ok).toBe(true);
    expect(spellChecker.getProjectWords()).toEqual(['blarg', 'zorp']);
    expect(spellChecker.getIgnoredWords()).toContain('quux');
    expect(spellChecker.isProjectDictionaryEnabled()).toBe(false);
    expect(grammarIgnore.getIgnoredRules()).toContain('RULE_ONE');
    expect(useEditorStore.getState().grammarCheckEnabled).toBe(true);
  });

  it('does not leak the previous script\'s words into the next one', () => {
    hydrateEditorStoresFromContent({ ...DOC, _customDictWords: ['zorp'] });
    hydrateEditorStoresFromContent({ ...DOC, _customDictWords: [] });
    expect(spellChecker.getProjectWords()).toEqual([]);
    expect(spellChecker.isProjectDictionaryEnabled()).toBe(true);
    expect(useEditorStore.getState().grammarCheckEnabled).toBe(false);
  });

  it('writes the project dictionary words into the saved content', () => {
    spellChecker.setProjectWords(['zorp']);
    const fakeEditor = { getJSON: () => DOC };
    const saved = buildSaveContent(fakeEditor as any) as Record<string, unknown>;
    expect(saved._customDictWords).toEqual(['zorp']);
  });
});
