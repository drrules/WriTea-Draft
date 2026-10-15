import { getScratchUrlSync } from '../services/scratchAssets';

/**
 * A URL the page can load for one of the open script's assets, or '' when there
 * is none yet (the store is still starting, or the file is not on this computer).
 */
export function scriptAssetUrl(assetId: string): string {
  return getScratchUrlSync(assetId) ?? '';
}
