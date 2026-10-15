import React, { useState, useCallback, useMemo, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorStore } from '../stores/editorStore';
import { useLocationStore, type LocationEntry } from '../stores/locationStore';
import { discoverLocationEntries, newLocationEntry, parseLocationFromHeading } from '../utils/locations';
import { showToast } from './Toast';
import { useDelayedUnmount, useSwipeDismiss } from '../hooks/useTouch';
import { blockContentRange, singleLine } from '../utils/nodeText';
import Select from './Select';

interface Props {
  editor: Editor | null;
  style?: React.CSSProperties;
}

const TYPE_LABEL: Record<string, string> = {
  interior: 'Interior',
  exterior: 'Exterior',
  both: 'Both',
};

const LocationDatabase: React.FC<Props> = ({ editor, style }) => {
  const { locationDatabaseOpen, toggleLocationDatabase, scenes, setSaveStatus } = useEditorStore();
  const locations = useLocationStore((s) => s.locations);
  const setLocations = useLocationStore((s) => s.setLocations);
  // Every change marks the script unsaved: the list lives inside the file.
  const commit = useCallback((next: LocationEntry[]) => {
    setLocations(next);
    setSaveStatus('unsaved');
  }, [setLocations, setSaveStatus]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<LocationEntry>>({});
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');

  const panelRef = useRef<HTMLDivElement>(null);

  const { shouldRender, animationState } = useDelayedUnmount(locationDatabaseOpen, 250);
  useSwipeDismiss(panelRef, { direction: 'right', onDismiss: toggleLocationDatabase, enabled: shouldRender });

  // Map location name → scenes referencing it, derived from current scenes store
  const locationSceneCounts = useMemo(() => {
    const counts = new Map<string, number[]>();
    scenes.forEach((scene, i) => {
      const name = parseLocationFromHeading(scene.heading);
      if (!name) return;
      if (!counts.has(name)) counts.set(name, []);
      counts.get(name)!.push(i);
    });
    return counts;
  }, [scenes]);

  const getSceneCount = useCallback((loc: LocationEntry): number => {
    const fromName = locationSceneCounts.get(loc.name)?.length || 0;
    const fromAliases = loc.aliases.reduce((sum, a) => sum + (locationSceneCounts.get(a)?.length || 0), 0);
    return fromName + fromAliases;
  }, [locationSceneCounts]);

  const discovered = useCallback(() => {
    const found = discoverLocationEntries(scenes.map((s) => s.heading), locations);
    if (found.length > 0) commit([...locations, ...found]);
    showToast(
      found.length > 0
        ? `Discovered ${found.length} new location${found.length === 1 ? '' : 's'}`
        : 'No new locations found',
      'success',
    );
  }, [scenes, locations, commit]);

  const handleAdd = useCallback(() => {
    const name = newName.trim().toUpperCase();
    if (!name) return;
    const existing = locations.find((l) => l.name === name || l.aliases.includes(name));
    if (existing) {
      setSelectedId(existing.id);
      setNewName('');
      return;
    }
    const entry = newLocationEntry(name, 'interior');
    commit([...locations, entry]);
    setSelectedId(entry.id);
    setNewName('');
  }, [newName, locations, commit]);

  const startEdit = useCallback((loc: LocationEntry) => {
    setEditingId(loc.id);
    setDraft({ ...loc });
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setDraft({});
  }, []);

  const saveEdit = useCallback(() => {
    if (!editingId) return;
    const name = (draft.name || '').trim().toUpperCase();
    if (!name) {
      showToast('A location needs a name', 'error');
      return;
    }
    commit(locations.map((l) => (l.id === editingId ? ({ ...l, ...draft, name } as LocationEntry) : l)));
    setEditingId(null);
    setDraft({});
    showToast('Location updated', 'success');
  }, [editingId, draft, locations, commit]);

  const handleDelete = useCallback((loc: LocationEntry) => {
    if (!window.confirm(`Delete location "${loc.name}"? Scene headings will not be changed.`)) return;
    commit(locations.filter((l) => l.id !== loc.id));
    if (selectedId === loc.id) setSelectedId(null);
    showToast('Location deleted', 'success');
  }, [locations, selectedId, commit]);

  const handleRenameInHeadings = useCallback((loc: LocationEntry, newName: string) => {
    if (!editor) return;
    const oldName = loc.name;
    const canonical = newName.trim().toUpperCase();
    if (!canonical || canonical === oldName) return;
    const { state } = editor;
    const { tr } = state;
    let changed = 0;
    let skippedBroken = 0;
    state.doc.descendants((node, pos) => {
      if (node.type.name !== 'sceneHeading') return true;
      const text = node.textContent;
      // A heading containing a hard break can't be rewritten: insertText over
      // the inline range would flatten the break into plain text. Skip it and
      // report, rather than silently reformatting the writer's content.
      if (text.includes('\n')) {
        if (parseLocationFromHeading(singleLine(text)) === oldName) skippedBroken++;
        return true;
      }
      const parsed = parseLocationFromHeading(text);
      if (parsed !== oldName) return true;
      // Replace the location portion in the heading
      const newText = text.replace(new RegExp(oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), canonical);
      if (newText === text) return true;
      // Derive the range from nodeSize, never `pos + 1 + text.length` — the
      // latter is short by one per inline atom, leaving the heading's tail
      // behind and duplicating it.
      const { from, to } = blockContentRange(node, pos);
      tr.insertText(newText, from, to);
      changed++;
      return true;
    });
    if (changed > 0) editor.view.dispatch(tr);
    if (skippedBroken > 0) {
      showToast(
        `Skipped ${skippedBroken} scene heading${skippedBroken === 1 ? '' : 's'} containing a line break`,
        'info',
      );
    }
    return changed;
  }, [editor]);

  const goToScene = useCallback((sceneIndex: number) => {
    if (!editor) return;
    const { doc } = editor.state;
    let currentScene = -1;
    let targetPos = 0;
    doc.descendants((node, pos) => {
      if (node.type.name === 'sceneHeading') {
        currentScene++;
        if (currentScene === sceneIndex) { targetPos = pos; return false; }
      }
      return true;
    });
    editor.chain().focus().setTextSelection(targetPos + 1).run();
  }, [editor]);

  const filteredLocations = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return locations;
    return locations.filter((l) =>
      l.name.includes(q) ||
      l.fullName.toUpperCase().includes(q) ||
      l.aliases.some((a) => a.includes(q)) ||
      l.address.toUpperCase().includes(q),
    );
  }, [locations, search]);

  const selected = selectedId ? locations.find((l) => l.id === selectedId) : null;

  if (!shouldRender) return null;

  const panelClass = animationState === 'entered' ? 'panel-open'
    : animationState === 'exiting' ? 'panel-closing' : '';

  return (
    <div ref={panelRef} className={`location-database ${panelClass}`} style={style}>
      <div className="location-db-header">
        <span className="location-db-title">Locations</span>
        <button
          className="location-db-discover"
          onClick={discovered}
          title="Scan the scene headings and add an entry for each new location"
        >
          ⟳ Discover
        </button>
        <button className="location-db-close" onClick={toggleLocationDatabase} title="Close">×</button>
      </div>

      <div className="location-db-search">
        <input
          type="text"
          placeholder="Search locations…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="location-db-search">
        <input
          type="text"
          placeholder="Add a location… (press Enter)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
        />
      </div>

      <div className="location-db-body">
        <div className="location-db-list">
          {filteredLocations.length === 0 ? (
            <div className="location-db-empty">
              {locations.length === 0
                ? 'No locations yet. Click Discover to auto-create from scene headings.'
                : 'No locations match your search.'}
            </div>
          ) : (
            filteredLocations.map((loc) => (
              <div
                key={loc.id}
                className={`location-db-card${selectedId === loc.id ? ' selected' : ''}`}
                onClick={() => setSelectedId(loc.id)}
              >
                <div className="location-db-card-header">
                  <span className="location-db-card-name">{loc.name}</span>
                  <span className="location-db-card-count">{getSceneCount(loc)}</span>
                </div>
                <div className="location-db-card-meta">
                  <span className={`location-db-type location-db-type-${loc.type}`}>
                    {TYPE_LABEL[loc.type] || loc.type}
                  </span>
                  {loc.address && <span className="location-db-card-address">{loc.address}</span>}
                </div>
                {loc.tags.length > 0 && (
                  <div className="location-db-card-tags">
                    {loc.tags.map((t) => (
                      <span key={t} className="location-db-tag">{t}</span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {selected && (
          <div className="location-db-detail">
            {editingId === selected.id ? (
              <LocationEditor
                draft={draft}
                setDraft={setDraft}
                onSave={saveEdit}
                onCancel={cancelEdit}
                originalName={selected.name}
                onRenameHeadings={(newName) => {
                  const n = handleRenameInHeadings(selected, newName);
                  if (n && n > 0) showToast(`Renamed ${n} scene heading${n === 1 ? '' : 's'}`, 'success');
                }}
              />
            ) : (
              <LocationDetailView
                loc={selected}
                sceneIndices={
                  (locationSceneCounts.get(selected.name) || [])
                    .concat(...selected.aliases.map((a) => locationSceneCounts.get(a) || []))
                }
                scenes={scenes}
                onEdit={() => startEdit(selected)}
                onDelete={() => handleDelete(selected)}
                onGoToScene={goToScene}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Sub-components ─────────────────────────────────────────────────────────

interface DetailViewProps {
  loc: LocationEntry;
  sceneIndices: number[];
  scenes: Array<{ id: string; heading: string; synopsis: string; color: string; sceneNumber?: string | null }>;
  onEdit: () => void;
  onDelete: () => void;
  onGoToScene: (sceneIndex: number) => void;
}

const LocationDetailView: React.FC<DetailViewProps> = ({ loc, sceneIndices, scenes, onEdit, onDelete, onGoToScene }) => (
  <>
    <div className="location-db-detail-header">
      <h3>{loc.name}</h3>
      <div className="location-db-detail-actions">
        <button onClick={onEdit}>Edit</button>
        <button onClick={onDelete} className="location-db-danger">Delete</button>
      </div>
    </div>
    {loc.fullName && <div className="location-db-field"><label>Full Name</label><div>{loc.fullName}</div></div>}
    <div className="location-db-field"><label>Type</label><div>{TYPE_LABEL[loc.type]}</div></div>
    {loc.address && <div className="location-db-field"><label>Address</label><div>{loc.address}</div></div>}
    {loc.contact && <div className="location-db-field"><label>Contact</label><div>{loc.contact}</div></div>}
    {loc.availability && <div className="location-db-field"><label>Availability</label><div>{loc.availability}</div></div>}
    {loc.notes && <div className="location-db-field"><label>Notes</label><div style={{ whiteSpace: 'pre-wrap' }}>{loc.notes}</div></div>}
    {loc.aliases.length > 0 && <div className="location-db-field"><label>Aliases</label><div>{loc.aliases.join(', ')}</div></div>}
    {loc.tags.length > 0 && (
      <div className="location-db-field">
        <label>Tags</label>
        <div className="location-db-card-tags">
          {loc.tags.map((t) => <span key={t} className="location-db-tag">{t}</span>)}
        </div>
      </div>
    )}
    <div className="location-db-field">
      <label>Scenes ({sceneIndices.length})</label>
      <div className="location-db-scenes">
        {sceneIndices.length === 0 ? (
          <em>No scenes reference this location.</em>
        ) : (
          sceneIndices.map((sceneIdx) => {
            const scene = scenes[sceneIdx];
            if (!scene) return null;
            return (
              <div key={sceneIdx} className="location-db-scene-row" onClick={() => onGoToScene(sceneIdx)}>
                <span className="location-db-scene-num">{sceneIdx + 1}</span>
                <span className="location-db-scene-heading">{scene.heading}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  </>
);

interface EditorProps {
  draft: Partial<LocationEntry>;
  setDraft: React.Dispatch<React.SetStateAction<Partial<LocationEntry>>>;
  onSave: () => void;
  onCancel: () => void;
  originalName: string;
  onRenameHeadings: (newName: string) => void;
}

const LocationEditor: React.FC<EditorProps> = ({ draft, setDraft, onSave, onCancel, originalName, onRenameHeadings }) => {
  const set = (patch: Partial<LocationEntry>) => setDraft((d) => ({ ...d, ...patch }));
  const currentName = (draft.name || '').toUpperCase();
  const nameChanged = currentName !== originalName && currentName.length > 0;

  return (
    <>
      <div className="location-db-detail-header">
        <h3>Edit Location</h3>
        <div className="location-db-detail-actions">
          <button onClick={onCancel}>Cancel</button>
          <button onClick={onSave} className="location-db-primary">Save</button>
        </div>
      </div>
      <div className="location-db-field">
        <label>Name</label>
        <input value={draft.name || ''} onChange={(e) => set({ name: e.target.value.toUpperCase() })} />
        {nameChanged && (
          <button
            className="location-db-secondary"
            style={{ marginTop: 4 }}
            onClick={() => onRenameHeadings(currentName)}
          >
            Rename in all scene headings →
          </button>
        )}
      </div>
      <div className="location-db-field">
        <label>Full Name</label>
        <input value={draft.fullName || ''} onChange={(e) => set({ fullName: e.target.value })} />
      </div>
      <div className="location-db-field">
        <label>Type</label>
        <Select value={draft.type || 'interior'} onChange={(e) => set({ type: e.target.value as LocationEntry['type'] })}>
          <option value="interior">Interior</option>
          <option value="exterior">Exterior</option>
          <option value="both">Both</option>
        </Select>
      </div>
      <div className="location-db-field">
        <label>Address</label>
        <input value={draft.address || ''} onChange={(e) => set({ address: e.target.value })} />
      </div>
      <div className="location-db-field">
        <label>Contact</label>
        <input value={draft.contact || ''} onChange={(e) => set({ contact: e.target.value })} />
      </div>
      <div className="location-db-field">
        <label>Availability</label>
        <input value={draft.availability || ''} onChange={(e) => set({ availability: e.target.value })} />
      </div>
      <div className="location-db-field">
        <label>Notes</label>
        <textarea
          value={draft.notes || ''}
          onChange={(e) => set({ notes: e.target.value })}
          rows={4}
        />
      </div>
      <div className="location-db-field">
        <label>Aliases (comma-separated)</label>
        <input
          value={(draft.aliases || []).join(', ')}
          onChange={(e) => set({ aliases: e.target.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) })}
        />
      </div>
      <div className="location-db-field">
        <label>Tags (comma-separated)</label>
        <input
          value={(draft.tags || []).join(', ')}
          onChange={(e) => set({ tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
        />
      </div>
    </>
  );
};

export default LocationDatabase;
