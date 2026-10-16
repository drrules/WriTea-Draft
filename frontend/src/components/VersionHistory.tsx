import React, { useState, useCallback, useMemo } from 'react';
import type { Editor, JSONContent } from '@tiptap/react';
import { useVersionUiStore } from '../stores/versionUiStore';
import { useVersionStore } from '../stores/versionStore';
import { useEditorStore } from '../stores/editorStore';
import {
  createStoredVersion, readStoredVersion, summariesNewestFirst, diffDocs,
} from '../services/scriptVersions';
import type { VersionSummary } from '../services/scriptVersions';
import DiffViewer from './DiffViewer';
import ScriptDiffView from './ScriptDiffView';
import { showToast } from './Toast';
import { relativeTime } from '../utils/relativeTime';

interface VersionHistoryProps {
  editor: Editor | null;
}

async function readById(id: string): Promise<unknown> {
  const stored = useVersionStore.getState().versions.find((v) => v.id === id);
  if (!stored) throw new Error('That version is no longer in this script.');
  return readStoredVersion(stored);
}

/**
 * The check-ins of the open script. They live in the script itself, so this
 * needs no project: the list, the changes in each one, a compare of any two,
 * a compare against the current text, and restoring one.
 */
const VersionHistory: React.FC<VersionHistoryProps> = ({ editor }) => {
  const { versionHistoryOpen, setVersionHistoryOpen } = useVersionUiStore();
  const stored = useVersionStore((s) => s.versions);
  const versions = useMemo(() => summariesNewestFirst(stored), [stored]);

  const [selectedVersion, setSelectedVersion] = useState<VersionSummary | null>(null);
  const [diffText, setDiffText] = useState<string | null>(null);

  // Compare mode: checkboxes on version rows
  const [compareSelection, setCompareSelection] = useState<string[]>([]);
  const [scriptDiff, setScriptDiff] = useState<{
    docA: JSONContent;
    docB: JSONContent;
    labelA: string;
    labelB: string;
  } | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState<VersionSummary | null>(null);

  const toggleCompareSelect = useCallback((hash: string) => {
    setCompareSelection((prev) => {
      if (prev.includes(hash)) return prev.filter((h) => h !== hash);
      if (prev.length >= 2) return [prev[1], hash]; // keep a rolling window of two
      return [...prev, hash];
    });
  }, []);

  const runScriptCompare = useCallback(async () => {
    if (compareSelection.length !== 2) return;
    const vA = versions.find((v) => v.hash === compareSelection[0]);
    const vB = versions.find((v) => v.hash === compareSelection[1]);
    if (!vA || !vB) {
      showToast('Selected versions no longer available', 'error');
      return;
    }
    // Order: earlier version = A, later = B
    const aIsEarlier = new Date(vA.date).getTime() < new Date(vB.date).getTime();
    const earlier = aIsEarlier ? vA : vB;
    const later = aIsEarlier ? vB : vA;
    try {
      const [docA, docB] = await Promise.all([readById(earlier.hash), readById(later.hash)]);
      setScriptDiff({
        docA: docA as JSONContent,
        docB: docB as JSONContent,
        labelA: `${earlier.short_hash} · ${earlier.message}`,
        labelB: `${later.short_hash} · ${later.message}`,
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load versions for comparison', 'error');
    }
  }, [compareSelection, versions]);

  const compareToCurrent = useCallback(async (v: VersionSummary) => {
    if (!editor) return;
    try {
      const docA = await readById(v.hash);
      setScriptDiff({
        docA: docA as JSONContent,
        docB: editor.getJSON(),
        labelA: `${v.short_hash} · ${v.message}`,
        labelB: 'Current script',
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load the version', 'error');
    }
  }, [editor]);

  const handleViewDiff = useCallback(
    async (version: VersionSummary, index: number) => {
      setSelectedVersion(version);
      // Versions are newest-first, so the one after this is the one before it in time.
      const prevVersion = versions[index + 1];
      if (!prevVersion) {
        setDiffText('(Initial version, no previous version to compare against)');
        return;
      }
      try {
        const [before, after] = await Promise.all([readById(prevVersion.hash), readById(version.hash)]);
        setDiffText(diffDocs(before, after));
      } catch (err) {
        setDiffText(`Error loading diff: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    },
    [versions],
  );

  const handleRestoreConfirm = useCallback(async () => {
    const target = restoreConfirm;
    setRestoreConfirm(null);
    if (!target || !editor) return;
    try {
      const doc = await readById(target.hash);
      // The current text is kept first, so a restore can always be undone.
      const safety = await createStoredVersion(editor.getJSON(), `Before restoring ${target.short_hash}`);
      useVersionStore.getState().addVersion(safety);
      editor.commands.setContent(doc as JSONContent);
      useEditorStore.getState().setSaveStatus('unsaved');
      setSelectedVersion(null);
      setDiffText(null);
      showToast(`Restored to version ${target.short_hash}`, 'success');
    } catch (err) {
      showToast(`Restore failed: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
    }
  }, [editor, restoreConfirm]);

  if (!versionHistoryOpen) return null;

  return (
    <div className="version-history-panel">
      <div className="version-history-header">
        <span className="version-history-title">Version History</span>
        <button
          className="version-history-close"
          onClick={() => {
            setVersionHistoryOpen(false);
            setSelectedVersion(null);
            setDiffText(null);
          }}
        >
          x
        </button>
      </div>

      {versions.length >= 2 && (
        <div className="version-compare-bar">
          <span className="version-compare-info">
            {compareSelection.length === 0 && 'Check two versions to compare'}
            {compareSelection.length === 1 && 'Select one more version to compare'}
            {compareSelection.length === 2 && 'Ready to compare'}
          </span>
          <button
            className="version-compare-btn"
            disabled={compareSelection.length !== 2}
            onClick={runScriptCompare}
          >
            Compare Selected
          </button>
          {compareSelection.length > 0 && (
            <button
              className="version-compare-clear"
              onClick={() => setCompareSelection([])}
            >
              Clear
            </button>
          )}
        </div>
      )}

      <div className="version-history-content">
        <div className="version-history-list">
          {versions.length === 0 && (
            <div className="version-history-empty">
              No versions yet. Use File &gt; Versions &gt; Check In to save a version.
            </div>
          )}
          {versions.map((v, i) => (
            <div
              key={v.hash}
              className={`version-item ${selectedVersion?.hash === v.hash ? 'selected' : ''}${compareSelection.includes(v.hash) ? ' compare-selected' : ''}`}
              onClick={() => handleViewDiff(v, i)}
            >
              <div className="version-item-top">
                <input
                  type="checkbox"
                  className="version-compare-checkbox"
                  checked={compareSelection.includes(v.hash)}
                  onChange={(e) => { e.stopPropagation(); toggleCompareSelect(v.hash); }}
                  onClick={(e) => e.stopPropagation()}
                  title="Select for compare"
                />
                <span className="version-hash">{v.short_hash}</span>
                <span className="version-date">{relativeTime(v.date)}</span>
              </div>
              <div className="version-message">{v.message}</div>
              <div className="version-item-actions">
                <button
                  className="version-view-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    void compareToCurrent(v);
                  }}
                  title="Show what has changed since this version"
                >
                  Compare to Current
                </button>
                <button
                  className="version-restore-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRestoreConfirm(v);
                  }}
                  title="Restore this version"
                >
                  Restore
                </button>
              </div>
            </div>
          ))}
        </div>

        {diffText !== null && selectedVersion && (
          <div className="version-diff-area">
            <div className="version-diff-header">
              <span>
                Changes in {selectedVersion.short_hash}: {selectedVersion.message}
              </span>
              <button
                className="version-diff-close"
                onClick={() => {
                  setSelectedVersion(null);
                  setDiffText(null);
                }}
              >
                x
              </button>
            </div>
            <DiffViewer diff={diffText} />
          </div>
        )}
      </div>
      {scriptDiff && (
        <div className="script-diff-overlay">
          <ScriptDiffView
            docA={scriptDiff.docA}
            docB={scriptDiff.docB}
            labelA={scriptDiff.labelA}
            labelB={scriptDiff.labelB}
            onClose={() => setScriptDiff(null)}
          />
        </div>
      )}
      {restoreConfirm && (
        <div className="dialog-overlay" onClick={() => setRestoreConfirm(null)}>
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">Restore Version</div>
            <div className="dialog-body">
              <p style={{ margin: 0 }}>
                Restore the script text to version <strong>{restoreConfirm.short_hash}</strong>?
                Your current text is checked in first as "Before restoring {restoreConfirm.short_hash}",
                so nothing is lost. Notes, beats and the other panels are not changed.
              </p>
            </div>
            <div className="dialog-actions">
              <button onClick={() => setRestoreConfirm(null)}>Cancel</button>
              <button className="dialog-primary" onClick={handleRestoreConfirm}>
                Restore
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VersionHistory;
