import React, { useState, useEffect } from 'react';
import { useGoBack } from '../hooks/useGoBack';
import { useSettingsStore } from '../stores/settingsStore';
import BackupSettingsSection from './BackupSettingsSection';
import SaveSettingsSection from './SaveSettingsSection';
import VoiceProviderSettings from './VoiceProviderSettings';
import { formatShortcut, isMacPlatform, shortcutFromEvent } from '../utils/shortcuts';
import { printRoute, isTauri as isTauriApp } from '../services/platform';

/**
 * Records a keyboard shortcut by listening for one.
 *
 * Click it, press the keys, done — the same gesture every application uses for
 * this, and the only one that does not ask a writer to know that Option is
 * spelled `Alt` in the file. What it shows back is the platform's own
 * spelling: ⌥↩ on a Mac, Alt+Enter elsewhere.
 */
const ShortcutField: React.FC<{
  id: string;
  value: string;
  onChange: (spec: string) => void;
}> = ({ id, value, onChange }) => {
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setListening(false); return; }
      // Swallow everything while listening, so a half-pressed combination
      // cannot trigger whatever it would normally do.
      e.preventDefault();
      e.stopPropagation();
      const spec = shortcutFromEvent(e);
      // A bare modifier on the way to a combination: keep waiting for the rest.
      if (!spec) return;
      onChange(spec);
      setListening(false);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [listening, onChange]);

  const label = listening
    ? 'Press the keys\u2026'
    : (formatShortcut(value) || 'None');

  return (
    <span className="shortcut-field">
      <button
        id={id}
        type="button"
        className={`dialog-input shortcut-capture${listening ? ' is-listening' : ''}`}
        onClick={() => setListening((on) => !on)}
        aria-live="polite"
      >
        {label}
      </button>
      <button
        type="button"
        className="shortcut-clear"
        onClick={() => { setListening(false); onChange(''); }}
        disabled={!value && !listening}
      >
        Clear
      </button>
    </span>
  );
};

const SettingsPage: React.FC = () => {
  const goBack = useGoBack();
  const {
    elementMenuOnEnter, setElementMenuOnEnter,
    printViaPdf, setPrintViaPdf,
    elementMenuShortcut, setElementMenuShortcut,
  } = useSettingsStore();

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="settings-back-btn" onClick={goBack} title="Go back">
          &larr;
        </button>
        <h1>WriTea Settings</h1>
      </div>

      <div className="settings-content">
        <SaveSettingsSection />

        <BackupSettingsSection />

        {/* ── Printing ──
            Only where there is a choice to make. iPad, iPhone and Android have
            no print dialog of their own — printRoute() explains why — so they
            print the PDF whatever this says, and a switch that changed nothing
            would be worse than no switch at all. */}
        {printRoute() === 'dialog' && (
        <section className="settings-section">
          <h2 className="settings-section-title">Printing</h2>
          <p className="settings-section-desc">
            What File &rarr; Print sends to the printer.
          </p>

          <div className="settings-row">
            <label>
              <input
                type="checkbox"
                checked={printViaPdf}
                onChange={(e) => setPrintViaPdf(e.target.checked)}
              />{' '}
              Print the PDF, so the pages match the ones on screen
            </label>
            <div className="settings-hint">
              The editor draws its page turns rather than making them, so
              printing the page asks the browser to lay the script out a second
              time &mdash; and it can end its pages somewhere else. Printing the
              PDF gives the pages you have been looking at, and the same
              document anyone you send the export to would read. Turn this off
              to use the browser's own print dialog instead, which is quicker on
              a long script and is what its margin and scaling controls apply
              to.
            </div>
          </div>
        </section>
        )}

        {/* ── Table Read (issue #131) ── */}
        <section className="settings-section">
          <h2 className="settings-section-title">Table Read Voices</h2>
          <p className="settings-section-desc">
            The voices Tools &rarr; Table Read uses to read the script aloud: the ones
            installed on this {isTauriApp() ? 'device' : 'computer'}, or an AI voice provider.
            Each character&rsquo;s voice is chosen on their profile in the Characters panel.
          </p>
          <VoiceProviderSettings />
        </section>

        {/* ── Editing ── */}
        <section className="settings-section">
          <h2 className="settings-section-title">Editing</h2>
          <p className="settings-section-desc">
            How the editor responds while you write.
          </p>

          <div className="settings-row">
            <label>
              <input
                type="checkbox"
                checked={elementMenuOnEnter}
                onChange={(e) => setElementMenuOnEnter(e.target.checked)}
              />{' '}
              Offer the element menu when I press Enter on a blank line
            </label>
            <div className="settings-hint">
              On a blank line, Enter opens a menu of element types. Press Enter
              again — or choose Blank Line — to keep the blank line instead.
              Turn this off to make Enter always insert a plain line.
            </div>
          </div>

          <div className="settings-row">
            <label htmlFor="element-menu-shortcut">Element menu shortcut</label>
            <ShortcutField
              id="element-menu-shortcut"
              value={elementMenuShortcut}
              onChange={setElementMenuShortcut}
            />
            <div className="settings-hint">
              Opens the element menu wherever the cursor is, on a blank line or
              a line with text. This is the way to it if you turn the setting
              above off. Click the box and press the keys you want; the
              combination needs at least one of {isMacPlatform() ? '⌘, ⌥ or ⌃' : 'Ctrl or Alt'}.
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default SettingsPage;
