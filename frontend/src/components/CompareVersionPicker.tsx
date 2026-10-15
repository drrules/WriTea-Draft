import React, { useMemo } from 'react';
import { useVersionStore } from '../stores/versionStore';
import { summariesNewestFirst } from '../services/scriptVersions';
import type { VersionSummary } from '../services/scriptVersions';
import { relativeTime } from '../utils/relativeTime';

interface CompareVersionPickerProps {
  onSelect: (version: VersionSummary) => void;
  onClose: () => void;
}

/** Pick one of this script's check-ins to compare the current text against. */
const CompareVersionPicker: React.FC<CompareVersionPickerProps> = ({
  onSelect,
  onClose,
}) => {
  const stored = useVersionStore((s) => s.versions);
  const versions = useMemo(() => summariesNewestFirst(stored), [stored]);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box compare-version-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">Compare with Version</div>
        <div className="dialog-body">
          {versions.length === 0 && (
            <p className="compare-version-empty">
              No versions yet. Use File &gt; Versions &gt; Check In to save a version.
            </p>
          )}

          <div className="compare-version-list">
            {versions.map((v) => (
              <div
                key={v.hash}
                className="compare-version-item"
                onClick={() => onSelect(v)}
              >
                <div className="compare-version-item-top">
                  <span className="version-hash">{v.short_hash}</span>
                  <span className="version-date">{relativeTime(v.date)}</span>
                </div>
                <div className="version-message">{v.message}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
};

export default CompareVersionPicker;
