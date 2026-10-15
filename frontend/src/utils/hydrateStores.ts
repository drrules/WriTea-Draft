/**
 * Restore the `_`-prefixed app metadata from an imported `.writea` payload.
 *
 * A saved script is the document plus notes, tags, beats, character profiles
 * and layout, all carried as `_`-prefixed top-level keys (see
 * `utils/saveContent.ts`). Loading a script from the library restores all of
 * them; importing an `.writea` file did not, so an imported backup came back
 * as bare text with every note and tag silently dropped.
 *
 * This also restores the spell and grammar state that travels with a script:
 * ignored words, the project dictionary words, enabled dictionaries, ignored
 * grammar rules and the grammar toggle. Auto spell check itself is an
 * app-wide setting and is not part of the file.
 */
import { useEditorStore, DEFAULT_TAG_CATEGORIES, DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { hasSaveMetadata } from './saveContent';
import { resolveSceneHeadingSpaceBefore } from './elementSpacing';
import { restoreRevisionState } from './revisionState';
import { spellChecker } from '../editor/spellchecker';
import { grammarIgnore } from '../editor/grammar/grammarIgnore';
import { useAssetStore, type Asset } from '../stores/assetStore';
import { normalizeScriptProfile } from './scriptProfile';

/**
 * Some payloads store these as JSON strings rather than arrays/objects,
 * depending on which backend wrote them.
 */
function parseAttr<T>(value: unknown, fallback: T): T {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

/**
 * Apply an imported payload's metadata to the stores.
 *
 * Returns false and changes nothing when the payload carries no metadata —
 * importing a v1 file or a bare document must never wipe the state the user
 * already has with empty defaults.
 */
export function hydrateEditorStoresFromContent(
  content: Record<string, unknown> | null | undefined,
): boolean {
  if (!content || !hasSaveMetadata(content)) return false;

  const store = useEditorStore.getState();
  const c = content as Record<string, any>;

  store.setNotes(parseAttr(c._notes, []));
  store.setGeneralNotes(parseAttr(c._generalNotes, []));
  store.setTags(parseAttr(c._tags, []));
  store.setTagCategories(parseAttr(c._tagCategories, DEFAULT_TAG_CATEGORIES));
  store.setCharacterProfiles(parseAttr(c._characterProfiles, []));
  store.setCharacterRelationships(parseAttr(c._characterRelationships, []));
  store.setBeats(parseAttr(c._beats, []));
  store.setBeatColumns(parseAttr(c._beatColumns, []));
  if (c._beatArrangeMode !== undefined) {
    store.setBeatArrangeMode(parseAttr<'auto' | 'custom'>(c._beatArrangeMode, 'auto'));
  }
  if (c._sceneNumbersVisible !== undefined) {
    store.setSceneNumbersVisible(c._sceneNumbersVisible === true);
  }
  if (c._sceneNumbersLocked !== undefined) {
    store.setSceneNumbersLocked(c._sceneNumbersLocked === true);
  }
  if (c._pageLayout !== undefined) {
    store.setPageLayout(parseAttr(c._pageLayout, DEFAULT_PAGE_LAYOUT));
  }
  store.setFdxRaw(c._fdxRaw && typeof c._fdxRaw === 'object' && (c._fdxRaw as { sections?: unknown }).sections
    ? (c._fdxRaw as import('./fdxPreserve').FdxRaw) : null);
  store.setSceneHeadingSpaceBefore(resolveSceneHeadingSpaceBefore(content));
  restoreRevisionState(content);
  // Always set: a script saved before profiles existed opens as Standard with
  // no genres, not with whatever the previous script had.
  store.setScriptProfile(normalizeScriptProfile(c._scriptProfile));

  // Spell and grammar state carried by the file. Absent keys fall back to
  // defaults, so opening one script never leaks another script's words.
  const list = (v: unknown): string[] => {
    const a = parseAttr<unknown>(v, []);
    return Array.isArray(a) ? a.map(String) : [];
  };
  spellChecker.setIgnoredWords(list(c._ignoredWords));
  spellChecker.setIgnoredOnce(list(c._ignoredOnce));
  spellChecker.setProjectWords(list(c._customDictWords));
  if (c._enabledGlobalDicts === undefined) {
    // Saved before global dictionaries existed: keep the old Personal words.
    const lib = store.customDictionaries;
    spellChecker.setEnabledGlobalDicts(lib['Personal'] ? ['Personal'] : []);
  } else {
    spellChecker.setEnabledGlobalDicts(list(c._enabledGlobalDicts));
  }
  spellChecker.setProjectDictionaryEnabled(
    typeof c._projectDictEnabled === 'boolean' ? c._projectDictEnabled : true,
  );
  grammarIgnore.setIgnoredRules(list(c._ignoredGrammarRules));
  grammarIgnore.setIgnoredOnce(list(c._ignoredGrammarOnce));
  store.setGrammarCheckEnabled(c._grammarCheckEnabled === true);
  const assetList = parseAttr<unknown>(c._assets, []);
  useAssetStore.getState().setAssets(Array.isArray(assetList) ? (assetList as Asset[]) : []);

  if (typeof c._templateId === 'string' && c._templateId) {
    try {
      useFormattingTemplateStore.getState().setActiveTemplateId(c._templateId);
    } catch (err) {
      console.warn('[import] could not apply template', c._templateId, err);
    }
  }

  return true;
}
