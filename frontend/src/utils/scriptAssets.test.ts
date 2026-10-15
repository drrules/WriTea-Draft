import { describe, it, expect } from 'vitest';
import { collectScratchIds } from './scratchRefs';
import { hydrateEditorStoresFromContent } from './hydrateStores';
import { buildSaveContent } from './saveContent';
import { useAssetStore } from '../stores/assetStore';

const ASSET = {
  id: 'a1', filename: 'a1.png', original_name: 'a.png', mime_type: 'image/png',
  size_bytes: 3, tags: ['t'], created_at: 'x',
};

describe('a script keeps its own assets', () => {
  it('protects asset ids and character photos from the sweeper and the packer', () => {
    const ids = collectScratchIds({
      type: 'doc', content: [],
      _assets: [{ id: 'a1' }],
      _characterProfiles: [{ name: 'X', images: ['p1', 'p2'] }],
    });
    expect([...ids].sort()).toEqual(['a1', 'p1', 'p2']);
  });
  it('restores the asset list from a file, and clears it for a file without one', () => {
    hydrateEditorStoresFromContent({ type: 'doc', content: [], _assets: [ASSET] });
    expect(useAssetStore.getState().assets.map((a) => a.id)).toEqual(['a1']);
    hydrateEditorStoresFromContent({ type: 'doc', content: [], _assets: [] });
    expect(useAssetStore.getState().assets).toEqual([]);
  });
  it('writes the asset list into the saved content', () => {
    useAssetStore.getState().setAssets([ASSET]);
    const saved = buildSaveContent({ getJSON: () => ({ type: 'doc', content: [] }) } as any) as Record<string, unknown>;
    expect(saved._assets).toEqual([ASSET]);
    useAssetStore.getState().setAssets([]);
  });
});
