/**
 * Settings, Saving.
 *
 * Whether WriTea Draft writes your open file on its own, and how often. An
 * auto-save rewrites the writer's own file, in whatever format it is in.
 */
import React from 'react';
import { useSettingsStore, AUTO_SAVE_INTERVAL_OPTIONS } from '../stores/settingsStore';
import { supportsOpenInPlace } from '../utils/fileOps';
import { isDesktopTauri } from '../services/platform';
import {
  LINKED_FILE_FORMATS, LINKED_FORMAT_LABELS, normalizeLinkedFormat,
} from '../utils/linkedFileFormat';
import Select from './Select';

function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = seconds / 60;
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

const SaveSettingsSection: React.FC = () => {
  const {
    autoSaveFiles, setAutoSaveFiles,
    autoSaveIntervalSeconds, setAutoSaveIntervalSeconds,
    defaultFileFormat, setDefaultFileFormat,
  } = useSettingsStore();

  const filesSupported = supportsOpenInPlace();
  const desktop = isDesktopTauri();
  const fileMenuLabel = desktop ? 'Open File from Disk' : 'Open from Files';

  // A value set by hand (or by an older build) that is not one of the options
  // is still shown, so the select never claims a different interval than the
  // one in effect.
  const intervalOptions: number[] = (AUTO_SAVE_INTERVAL_OPTIONS as readonly number[]).includes(autoSaveIntervalSeconds)
    ? [...AUTO_SAVE_INTERVAL_OPTIONS]
    : [...AUTO_SAVE_INTERVAL_OPTIONS, autoSaveIntervalSeconds].sort((a, b) => a - b);

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Saving</h2>
      <p className="settings-section-desc">
        Choose whether WriTea Draft saves your work on its own. With auto-save off,
        nothing is written until you choose <strong>Save</strong>. WriTea Draft asks
        before you close a script, open another one or close the window. A
        recovery copy is still kept in case the app quits unexpectedly.
      </p>

      {filesSupported && (
        <div className="settings-row">
          <label>
            <input
              type="checkbox"
              checked={autoSaveFiles}
              onChange={(e) => setAutoSaveFiles(e.target.checked)}
            />{' '}
            Auto-save files opened with {fileMenuLabel}
          </label>
          <div className="settings-hint">
            Each save writes over the original file. A Final Draft or Fountain file can
            only keep what its format supports, so notes and other
            WriTeaDraft-only details are not saved into it.
          </div>
        </div>
      )}

      <div className="settings-row">
        <label>Auto-save every</label>
        <Select
          className="dialog-input"
          value={autoSaveIntervalSeconds}
          disabled={!(filesSupported && autoSaveFiles)}
          onChange={(e) => setAutoSaveIntervalSeconds(Number(e.target.value))}
        >
          {intervalOptions.map((sec) => (
            <option key={sec} value={sec}>{formatInterval(sec)}</option>
          ))}
        </Select>
      </div>

      {desktop && (
        <div className="settings-row">
          <label>Save new files as</label>
          <Select
            className="dialog-input"
            value={normalizeLinkedFormat(defaultFileFormat)}
            onChange={(e) => setDefaultFileFormat(e.target.value)}
          >
            {LINKED_FILE_FORMATS.map((f) => (
              <option key={f} value={f}>{LINKED_FORMAT_LABELS[f]}</option>
            ))}
          </Select>
          <div className="settings-hint">
            Scripts are saved as Final Draft (.fdx) files. Treatments cannot be
            written as screenplays, so they are kept in WriTea Draft&apos;s own format.
          </div>
        </div>
      )}
    </section>
  );
};

export default SaveSettingsSection;
