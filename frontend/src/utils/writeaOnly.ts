import { collectScratchIds } from './scratchRefs';

/**
 * What a script holds that a Final Draft file cannot.
 *
 * The one list behind both directions of the save flow: an .fdx with any of
 * this must not be overwritten (the save would quietly drop it), and a .writea
 * with none of it can be offered as a plain .fdx. Each entry is a short phrase
 * for the dialog.
 */
export function writeaOnlyContent(content: Record<string, unknown> | null | undefined): string[] {
  if (!content) return [];
  const reasons: string[] = [];
  if (collectScratchIds(content).size > 0) reasons.push('pictures and assets');
  const relationships = content['_characterRelationships'];
  if (Array.isArray(relationships) && relationships.length > 0) reasons.push('character relationships');
  const versions = content['_versions'];
  if (Array.isArray(versions) && versions.length > 0) reasons.push('version history');
  return reasons;
}
