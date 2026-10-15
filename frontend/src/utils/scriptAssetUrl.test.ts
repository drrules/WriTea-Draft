import { describe, it, expect } from 'vitest';
import { scriptAssetUrl } from './scriptAssetUrl';

describe('scriptAssetUrl', () => {
  it('is empty for an asset the store does not know', () => {
    expect(scriptAssetUrl('no-such-asset')).toBe('');
  });
});
