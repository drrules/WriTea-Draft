import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAssetStore } from '../stores/assetStore';
import type { Asset } from '../stores/assetStore';
import { useEditorStore } from '../stores/editorStore';
import AssetViewer from './AssetViewer';
import { putScratchAsset, getScratchBytes } from '../services/scratchAssets';
import { saveFile } from '../utils/fileOps';
import { showToast } from './Toast';
import Select from './Select';

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
  mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm',
  txt: 'text/plain',
};

function parseTags(raw: string): string[] {
  return raw.trim() ? raw.trim().split(',').map((t) => t.trim()).filter(Boolean) : [];
}

/** Every change to the list leaves the script with something new to save. */
function commit(next: Asset[]): void {
  useAssetStore.getState().setAssets(next);
  useEditorStore.getState().setSaveStatus('unsaved');
}

/** Ask before an asset leaves the list, with the native dialog where there is one. */
async function confirmRemove(name: string): Promise<boolean> {
  const message = `Remove "${name}" from this script's assets?\n\nYou can undo this until you close the Asset Manager.`;
  try {
    const { ask } = await import('@tauri-apps/plugin-dialog');
    return await ask(message, { title: 'Remove asset', kind: 'warning', okLabel: 'Remove', cancelLabel: 'Cancel' });
  } catch {
    return window.confirm(message);
  }
}

/**
 * The assets of the open script: pictures, audio, PDFs and so on. The list is
 * saved inside the script, and the files themselves travel in its .writea.
 */
const AssetManager: React.FC = () => {
  const { assets, assetManagerOpen, setAssetManagerOpen } = useAssetStore();
  const [filterText, setFilterText] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null);
  const [editTagsValue, setEditTagsValue] = useState('');
  const [lastRemoved, setLastRemoved] = useState<{ asset: Asset; index: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    const tags = parseTags(tagInput);
    const added: Asset[] = [];
    for (const file of files) {
      const meta = await putScratchAsset(file, file.name);
      if (!meta) {
        showToast(`Could not add "${file.name}"`, 'error');
        continue;
      }
      added.push({
        id: meta.id,
        filename: meta.filename,
        original_name: file.name,
        mime_type: meta.mimeType,
        size_bytes: meta.sizeBytes,
        tags,
        created_at: new Date().toISOString(),
      });
    }
    if (added.length > 0) commit([...useAssetStore.getState().assets, ...added]);
    setTagInput('');
    setUploading(false);
    if (added.length > 0) {
      showToast(`Added ${added.length} file${added.length !== 1 ? 's' : ''}`, 'success');
    }
  }, [tagInput]);

  // Handle Tauri native drag-and-drop forwarded from ScreenplayEditor
  useEffect(() => {
    if (!assetManagerOpen) return;
    const handler = async (e: Event) => {
      const paths = (e as CustomEvent).detail?.paths as string[] | undefined;
      if (!paths || paths.length === 0) return;
      try {
        const { readFile } = await import('@tauri-apps/plugin-fs');
        const files: File[] = [];
        for (const filePath of paths) {
          const filename = filePath.replace(/^.*[\\/]/, '') || 'file';
          try {
            const data = await readFile(filePath);
            const ext = filename.split('.').pop()?.toLowerCase() || '';
            files.push(new File([data], filename, { type: MIME_BY_EXTENSION[ext] || 'application/octet-stream' }));
          } catch {
            showToast(`Could not read "${filename}"`, 'error');
          }
        }
        await addFiles(files);
      } catch {
        setUploading(false);
      }
    };
    window.addEventListener('tauri-asset-drop', handler);
    return () => window.removeEventListener('tauri-asset-drop', handler);
  }, [assetManagerOpen, addFiles]);

  // The undo offer lasts only while the Asset Manager stays open.
  useEffect(() => {
    if (!assetManagerOpen) setLastRemoved(null);
  }, [assetManagerOpen]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    await addFiles(Array.from(files));
  };

  const handleRemove = async (assetId: string) => {
    const current = useAssetStore.getState().assets;
    const index = current.findIndex((a) => a.id === assetId);
    if (index === -1) return;
    const asset = current[index];
    if (!(await confirmRemove(asset.original_name))) return;
    commit(useAssetStore.getState().assets.filter((a) => a.id !== assetId));
    setLastRemoved({ asset, index });
  };

  const handleUndoRemove = () => {
    if (!lastRemoved) return;
    const current = useAssetStore.getState().assets;
    if (!current.some((a) => a.id === lastRemoved.asset.id)) {
      const next = [...current];
      next.splice(Math.min(lastRemoved.index, next.length), 0, lastRemoved.asset);
      commit(next);
    }
    setLastRemoved(null);
  };

  const handleDownload = async (asset: Asset) => {
    const bytes = await getScratchBytes(asset.id);
    if (!bytes) {
      showToast(`"${asset.original_name}" is missing from this computer.`, 'error');
      return;
    }
    try {
      await saveFile(bytes, asset.original_name);
    } catch (err) {
      showToast(`Could not save the file: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
    }
  };

  const handleSaveTags = (assetId: string) => {
    const tags = editTagsValue.split(',').map((t) => t.trim()).filter(Boolean);
    commit(useAssetStore.getState().assets.map((a) => (a.id === assetId ? { ...a, tags } : a)));
    setEditingTagsId(null);
    showToast('Tags updated', 'success');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  };

  // Collect all unique tags
  const allTags = Array.from(new Set(assets.flatMap((a) => a.tags))).sort();

  // Filter assets
  const filtered = assets.filter((a) => {
    const nameMatch = !filterText || a.original_name.toLowerCase().includes(filterText.toLowerCase());
    const tagMatch = !filterTag || a.tags.includes(filterTag);
    return nameMatch && tagMatch;
  });

  const getMimeIcon = (mime: string): string => {
    if (mime.startsWith('image/')) return '\ud83d\uddbc';
    if (mime.startsWith('audio/')) return '\ud83c\udfb5';
    if (mime.startsWith('video/')) return '\ud83c\udfac';
    if (mime === 'application/pdf') return '\ud83d\udcc4';
    if (mime.startsWith('text/')) return '\ud83d\udcdd';
    return '\ud83d\udcc1';
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!assetManagerOpen) return null;

  return (
    <div className="dialog-overlay" onClick={() => setAssetManagerOpen(false)}>
      <div className="asset-manager dialog" onClick={(e) => e.stopPropagation()}>
        <div className="asset-manager-header">
          <span>Asset Manager</span>
          <button className="asset-manager-close" onClick={() => setAssetManagerOpen(false)}>
            &times;
          </button>
        </div>
        <div className="asset-manager-content">
          {/* Upload section */}
          <div
            className={`asset-upload-zone ${dragOver ? 'drag-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => { handleUpload(e.target.files); e.target.value = ''; }}
            />
            <div className="asset-upload-icon">{uploading ? '\u23f3' : '\u2b06'}</div>
            <div className="asset-upload-text">
              {uploading ? 'Adding...' : 'Drop files here or click to add'}
            </div>
          </div>

          <div className="asset-tag-input-row">
            <label>Tags for new files:</label>
            <input
              type="text"
              placeholder="tag1, tag2, ..."
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              className="asset-tag-input"
            />
          </div>

          {/* Filter bar */}
          <div className="asset-filter-bar">
            <input
              type="text"
              placeholder="Search by name..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="asset-filter-input"
            />
            <Select
              value={filterTag}
              onChange={(e) => setFilterTag(e.target.value)}
              className="asset-filter-select"
            >
              <option value="">All Tags</option>
              {allTags.map((tag) => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
            </Select>
          </div>

          {/* Asset list */}
          <div className="asset-list">
            {filtered.length === 0 ? (
              <div className="asset-list-empty">
                {assets.length === 0 ? 'No assets yet. Add files to get started.' : 'No assets match your filters.'}
              </div>
            ) : (
              <table className="asset-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Name</th>
                    <th>Size</th>
                    <th>Tags</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((asset) => (
                    <tr key={asset.id} className="asset-row">
                      <td className="asset-cell-icon">
                        <span title={asset.mime_type}>{getMimeIcon(asset.mime_type)}</span>
                      </td>
                      <td
                        className="asset-cell-name"
                        onClick={() => setPreviewAsset(asset)}
                        title="Click to preview"
                      >
                        {asset.original_name}
                      </td>
                      <td className="asset-cell-size">{formatSize(asset.size_bytes)}</td>
                      <td className="asset-cell-tags">
                        {editingTagsId === asset.id ? (
                          <div className="asset-tags-edit">
                            <input
                              type="text"
                              value={editTagsValue}
                              onChange={(e) => setEditTagsValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveTags(asset.id);
                                if (e.key === 'Escape') setEditingTagsId(null);
                              }}
                              className="asset-tags-edit-input"
                              autoFocus
                            />
                            <button
                              className="asset-tags-save-btn"
                              onClick={() => handleSaveTags(asset.id)}
                            >
                              Save
                            </button>
                          </div>
                        ) : (
                          <div
                            className="asset-tags-display"
                            onClick={() => {
                              setEditingTagsId(asset.id);
                              setEditTagsValue(asset.tags.join(', '));
                            }}
                            title="Click to edit tags"
                          >
                            {asset.tags.length > 0
                              ? asset.tags.map((t) => (
                                  <span key={t} className="asset-tag-badge">#{t}</span>
                                ))
                              : <span className="asset-no-tags">no tags</span>
                            }
                          </div>
                        )}
                      </td>
                      <td className="asset-cell-actions">
                        <button
                          className="asset-action-btn"
                          onClick={() => handleDownload(asset)}
                          title="Save a copy"
                        >
                          &#x2B07;
                        </button>
                        <button
                          className="asset-action-btn asset-action-delete"
                          onClick={() => handleRemove(asset.id)}
                          title="Remove from this script"
                        >
                          {'\u2715'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {lastRemoved && (
            <div className="asset-list-empty" role="status">
              Removed "{lastRemoved.asset.original_name}".{' '}
              <button className="asset-tags-save-btn" onClick={handleUndoRemove}>Undo</button>
            </div>
          )}

          {/* Preview overlay */}
          {previewAsset && (
            <AssetViewer
              asset={previewAsset}
              onClose={() => setPreviewAsset(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default AssetManager;
