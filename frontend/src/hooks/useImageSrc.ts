/**
 * Turning image node attrs into something an `<img>` can load.
 *
 * Two ways an image is stored now:
 *
 *   1. `src`, a legacy inline data URL. Loads directly, synchronously.
 *   2. `scratchId`, bytes in the scratch store. On Tauri this resolves
 *      synchronously through `convertFileSrc`, which keeps a document full of
 *      images from flashing empty on open. On the web it needs an object URL,
 *      so it falls through to the async path.
 *
 * `missing` is deliberately part of the result. A scratch blob can be
 * legitimately unreachable (a `.writea` opened on another machine, or a blob
 * swept after its document was abandoned), and callers should show a
 * placeholder at the stored size rather than let the browser collapse a broken
 * image and shift pagination.
 */
import { useEffect, useMemo, useState } from 'react';
import { getScratchObjectUrl, getScratchUrlSync } from '../services/scratchAssets';

export interface ImageSrcAttrs {
  /** Left over from images saved inside an old project; no longer resolved. */
  assetId?: string | null;
  projectId?: string | null;
  filename?: string | null;
  scratchId?: string | null;
  src?: string | null;
}

export interface ImageSrcResult {
  /** URL to put on the `<img>`, or '' while resolving or unresolvable. */
  url: string;
  /** True once we know there is nothing to show. */
  missing: boolean;
}

export function useImageSrc(attrs: ImageSrcAttrs): ImageSrcResult {
  const src = attrs.src ?? null;
  const scratchId = attrs.scratchId ?? null;

  // Everything resolvable without awaiting. Computed first so the common cases
  // paint on the first render.
  const syncUrl = useMemo(() => {
    if (src) return src;
    if (scratchId) {
      const url = getScratchUrlSync(scratchId);
      if (url) return url;
    }
    return '';
  }, [src, scratchId]);

  // Which image the async result belongs to. Stored alongside the result rather
  // than cleared at the top of the effect: resetting state synchronously there
  // costs a cascading render on every attr change, and a stale result is already
  // detectable by comparing keys.
  const key = scratchId ?? '';
  const [resolved, setResolved] = useState<{ key: string; url: string; failed: boolean } | null>(null);
  const current = resolved && resolved.key === key ? resolved : null;

  useEffect(() => {
    if (syncUrl) return;

    let revoke: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        // Scratch bytes on the web, or on Tauri before the store has finished
        // initialising. `getScratchUrlSync` returns null in both cases, which
        // is why it means "use the async path" rather than "missing".
        if (scratchId) {
          const got = await getScratchObjectUrl(scratchId);
          if (!got) { if (!cancelled) setResolved({ key, url: '', failed: true }); return; }
          revoke = got.revoke;
          if (cancelled) { got.revoke(); return; }
          setResolved({ key, url: got.url, failed: false });
          return;
        }
        if (!cancelled) setResolved({ key, url: '', failed: true });
      } catch (err) {
        console.warn('[image] could not resolve an image:', err);
        if (!cancelled) setResolved({ key, url: '', failed: true });
      }
    })();

    return () => {
      cancelled = true;
      if (revoke) revoke();
    };
  }, [syncUrl, key, scratchId]);

  const url = syncUrl || current?.url || '';
  // Nothing referenced at all is also "missing": an image node with no source
  // is exactly the broken state the placeholder exists for.
  const nothingReferenced = !src && !scratchId;
  return { url, missing: !url && (current?.failed === true || nothingReferenced) };
}
