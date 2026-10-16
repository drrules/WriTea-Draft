import React, { useEffect, useState } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { spellChecker, PROJECT_DICT_TARGET, saveEnabledLanguagePreference } from '../editor/spellchecker';
import { BUNDLED_LANGUAGES } from '../editor/languageCatalog';

/** Subscribe to spellChecker.onChange so React re-renders when its state changes. */
function useSpellCheckerVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => spellChecker.onChange(() => setV((x) => x + 1)), []);
  return v;
}

const cardStyle: React.CSSProperties = {
  padding: '10px 12px',
  border: '1px solid var(--fd-border)',
  borderRadius: 6,
};

const buttonStyle: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--fd-border)',
  borderRadius: 4,
  background: 'var(--fd-bg)',
  color: 'var(--fd-text)',
  fontSize: 12,
  cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '6px 8px',
  border: '1px solid var(--fd-border)',
  borderRadius: 4,
  background: 'var(--fd-bg)',
  color: 'var(--fd-text)',
  fontSize: 13,
};

const sectionTitleStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 13,
  marginBottom: 6,
};

const helpTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--fd-text-muted)',
};

/** Compact pill button showing whether a dictionary is a write target. */
const AddTargetToggle: React.FC<{ active: boolean; onToggle: () => void; disabled?: boolean }> = ({
  active,
  onToggle,
  disabled,
}) => (
  <button
    type="button"
    onClick={onToggle}
    disabled={disabled}
    title={active ? 'Add to Dictionary writes here' : 'Click to make this an Add-to-Dictionary target'}
    style={{
      padding: '3px 8px',
      borderRadius: 12,
      border: `1px solid ${active ? '#2e7dd7' : 'var(--fd-border)'}`,
      background: active ? 'rgba(46,125,215,0.15)' : 'transparent',
      color: active ? '#2e7dd7' : 'var(--fd-text-muted)',
      fontSize: 11,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      whiteSpace: 'nowrap',
    }}
  >
    {active ? '✓ Add here' : 'Add here'}
  </button>
);

// ─── Languages ─────────────────────────────────────────────────────────────

const LanguagesSection: React.FC = () => {
  useSpellCheckerVersion();
  const loaded = new Set(spellChecker.getLoadedLanguages().map((l) => l.code));
  const enabled = new Set(spellChecker.getEnabledLanguages());

  const toggle = (code: string, on: boolean) => {
    const current = spellChecker.getEnabledLanguages();
    const next = on
      ? Array.from(new Set([...current, code]))
      : current.filter((c) => c !== code);
    spellChecker.setEnabledLanguages(next);
    saveEnabledLanguagePreference(spellChecker.getEnabledLanguages());
  };

  return (
    <div style={cardStyle}>
      <div style={sectionTitleStyle}>Languages</div>
      <div style={helpTextStyle}>
        Dictionaries that check your spelling. This applies to every script.
        Until you choose, it follows your system language.
      </div>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {BUNDLED_LANGUAGES.map(({ code, label, sample }) => (
          <label
            key={code}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 0',
              fontSize: 13,
            }}
          >
            <input
              type="checkbox"
              checked={enabled.has(code)}
              onChange={(e) => toggle(code, e.target.checked)}
            />
            <span style={{ flex: 1 }}>{label}</span>
            <span style={{ fontSize: 11, color: 'var(--fd-text-muted)' }}>
              {enabled.has(code) && !loaded.has(code) ? 'loading…' : (sample ?? '')}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
};

// ─── Script dictionary ────────────────────────────────────────────────────

const ProjectDictionarySection: React.FC = () => {
  useSpellCheckerVersion();
  const addTargets = useEditorStore((s) => s.addTargets);
  const setAddTargets = useEditorStore((s) => s.setAddTargets);
  const projectWords = spellChecker.getProjectWords();
  const projectEnabled = spellChecker.isProjectDictionaryEnabled();
  const [newWord, setNewWord] = useState('');
  const [expanded, setExpanded] = useState(false);

  const handleAdd = () => {
    const w = newWord.trim();
    if (!w) return;
    spellChecker.addToProjectDictionary(w);
    setNewWord('');
  };

  const toggleEnabled = (on: boolean) => {
    spellChecker.setProjectDictionaryEnabled(on);
  };

  const toggleAddTarget = () => {
    const has = addTargets.includes(PROJECT_DICT_TARGET);
    const next = has
      ? addTargets.filter((t) => t !== PROJECT_DICT_TARGET)
      : [...addTargets, PROJECT_DICT_TARGET];
    setAddTargets(next);
  };

  const isAddTarget = addTargets.includes(PROJECT_DICT_TARGET);

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={projectEnabled}
            onChange={(e) => toggleEnabled(e.target.checked)}
          />
          <div style={{ flex: 1 }}>
            <div style={sectionTitleStyle}>Script dictionary</div>
            <div style={helpTextStyle}>
              {projectEnabled
                ? projectWords.length === 0
                  ? 'No words yet. Anything you "Add to Dictionary" goes here by default.'
                  : `${projectWords.length} word${projectWords.length === 1 ? '' : 's'}. Saved with this script.`
                : 'Disabled for this script. Checks skip these words and "Add to Dictionary" routes to globals only.'}
            </div>
          </div>
        </label>
        <AddTargetToggle
          active={isAddTarget && projectEnabled}
          disabled={!projectEnabled}
          onToggle={toggleAddTarget}
        />
        <button type="button" onClick={() => setExpanded((x) => !x)} style={buttonStyle}>
          {expanded ? 'Hide' : 'Edit words…'}
        </button>
      </div>
      {expanded && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              placeholder="Add a word"
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
              style={inputStyle}
              disabled={!projectEnabled}
            />
            <button type="button" onClick={handleAdd} style={buttonStyle} disabled={!projectEnabled}>
              Add
            </button>
          </div>
          {projectWords.length > 0 && (
            <div
              style={{
                maxHeight: 200,
                overflowY: 'auto',
                border: '1px solid var(--fd-border)',
                borderRadius: 4,
                padding: 4,
              }}
            >
              {projectWords.map((w) => (
                <div
                  key={w}
                  style={{ display: 'flex', alignItems: 'center', padding: '4px 8px', fontSize: 13 }}
                >
                  <span style={{ flex: 1 }}>{w}</span>
                  <button
                    type="button"
                    onClick={() => spellChecker.removeFromProjectDictionary(w)}
                    title="Remove"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--fd-text-muted)',
                      cursor: 'pointer',
                      fontSize: 14,
                      padding: '0 4px',
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Global dictionaries ───────────────────────────────────────────────────

const GlobalDictionariesSection: React.FC<{ onOpenLibrary: () => void }> = ({ onOpenLibrary }) => {
  useSpellCheckerVersion();
  const customDictionaries = useEditorStore((s) => s.customDictionaries);
  const addTargets = useEditorStore((s) => s.addTargets);
  const setAddTargets = useEditorStore((s) => s.setAddTargets);
  const names = Object.keys(customDictionaries).sort();
  const enabled = new Set(spellChecker.getEnabledGlobalDicts());

  const toggleEnabled = (name: string, on: boolean) => {
    const current = spellChecker.getEnabledGlobalDicts();
    const next = on ? Array.from(new Set([...current, name])) : current.filter((n) => n !== name);
    spellChecker.setEnabledGlobalDicts(next);
  };

  const toggleAddTarget = (name: string) => {
    const has = addTargets.includes(name);
    const next = has ? addTargets.filter((t) => t !== name) : [...addTargets, name];
    setAddTargets(next);
  };

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={sectionTitleStyle}>Global dictionaries</div>
          <div style={helpTextStyle}>
            Reusable word lists shared across scripts. Enable any combination for this script.
          </div>
        </div>
        <button type="button" onClick={onOpenLibrary} style={buttonStyle}>Manage library…</button>
      </div>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {names.length === 0 && (
          <div style={helpTextStyle}>
            No global dictionaries yet. Click "Manage library…" to create one.
          </div>
        )}
        {names.map((name) => (
          <div
            key={name}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer', minWidth: 0 }}>
              <input
                type="checkbox"
                checked={enabled.has(name)}
                onChange={(e) => toggleEnabled(name, e.target.checked)}
              />
              <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {name}
              </span>
              <span style={{ fontSize: 11, color: 'var(--fd-text-muted)' }}>
                {customDictionaries[name].length} word{customDictionaries[name].length === 1 ? '' : 's'}
              </span>
            </label>
            <AddTargetToggle
              active={addTargets.includes(name) && enabled.has(name)}
              disabled={!enabled.has(name)}
              onToggle={() => toggleAddTarget(name)}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Settings ──────────────────────────────────────────────────────────────

const SpellingSettings: React.FC = () => {
  const spellingSettings = useEditorStore((s) => s.spellingSettings);
  const setSpellingSetting = useEditorStore((s) => s.setSpellingSetting);

  return (
    <div style={cardStyle}>
      <label
        style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}
      >
        <input
          type="checkbox"
          checked={spellingSettings.flagProperNouns}
          onChange={(e) => setSpellingSetting('flagProperNouns', e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <div style={{ flex: 1 }}>
          <div style={sectionTitleStyle}>Flag proper nouns</div>
          <div style={helpTextStyle}>
            When off, capitalized unknown words (names, places, brands) are not flagged.
            Turn on for stricter checking. Real proper nouns will then need to be added to a dictionary.
          </div>
        </div>
      </label>
    </div>
  );
};

// ─── Top-level panel ───────────────────────────────────────────────────────

const DictionaryConfigPanel: React.FC<{ onOpenLibrary: () => void }> = ({ onOpenLibrary }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <p style={{ fontSize: 12, color: 'var(--fd-text-muted)', marginTop: 0, marginBottom: 0 }}>
      Configure which dictionaries are active for this script and where
      "Add to Dictionary" sends new words.
    </p>
    <LanguagesSection />
    <ProjectDictionarySection />
    <GlobalDictionariesSection onOpenLibrary={onOpenLibrary} />
    <SpellingSettings />
  </div>
);

export default DictionaryConfigPanel;
