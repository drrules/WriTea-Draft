/**
 * WriTea Draft native format (.writea) import/export utilities.
 *
 * A .writea file is a JSON document holding the script, its metadata and
 * everything that goes with it, designed for lossless round-tripping. It is
 * also the format automatic backups are written in, which is why fidelity
 * matters here: a snapshot that can't be fully restored is not a backup.
 *
 * `content` is the full buildSaveContent() payload (the document plus every
 * `_`-prefixed store key), `meta` carries provenance, and `assets` may embed
 * the images the document references. Images live outside the document as
 * `assetId` references, so without embedding them a restored script comes
 * back with every image broken.
 *
 * Only files carrying this format's own tags are accepted. There is no reader
 * for any earlier format.
 */

import type { ScriptMeta } from './scriptMeta';

export const WRITEA_VERSION = 1;

export type BackupKind = 'auto' | 'manual' | 'crash';

export interface WriteaAsset {
  id: string;
  filename: string;
  mime_type: string;
  /** Base64-encoded bytes (no data: prefix). */
  data_base64: string;
}

export interface WriteaMeta {
  title: string;
  author: string;
  color: string;
  page_count: number;
  /** Provenance — lets a restore offer "put it back where it came from". */
  project_id?: string | null;
  script_id?: string | null;
  project_title?: string;
  app_version?: string;
  backup_kind?: BackupKind;
  /** True when images were deliberately left out (disabled, or over the cap). */
  assets_omitted?: boolean;
}

interface WriteaFile {
  writea_version: number;
  format: 'writea-script';
  exported_at: string;
  meta: WriteaMeta;
  content: Record<string, unknown>;
  assets?: WriteaAsset[];
}

export interface ParsedWritea {
  meta: WriteaMeta;
  content: Record<string, unknown>;
  assets: WriteaAsset[];
  /** Format version the file declared. */
  version: number;
}

export interface ExportWriteaOptions {
  assets?: WriteaAsset[];
  backupKind?: BackupKind;
  projectId?: string | null;
  scriptId?: string | null;
  projectTitle?: string;
  appVersion?: string;
  assetsOmitted?: boolean;
  /** Injectable for tests; defaults to now. */
  exportedAt?: string;
}

/** Build a .writea JSON blob from script metadata and content. */
export function exportWritea(
  meta: ScriptMeta,
  content: Record<string, unknown>,
  options: ExportWriteaOptions = {},
): Blob {
  return new Blob([serializeWritea(meta, content, options)], {
    type: 'application/json',
  });
}

/** The .writea JSON text. Separated from the Blob so callers that write to a
 *  file (backups) don't have to round-trip through Blob.text(). */
export function serializeWritea(
  meta: ScriptMeta,
  content: Record<string, unknown>,
  options: ExportWriteaOptions = {},
): string {
  const data: WriteaFile = {
    writea_version: WRITEA_VERSION,
    format: 'writea-script',
    exported_at: options.exportedAt || new Date().toISOString(),
    meta: {
      title: meta.title,
      author: meta.author,
      color: meta.color,
      page_count: meta.page_count,
      ...(options.projectId !== undefined ? { project_id: options.projectId } : {}),
      ...(options.scriptId !== undefined ? { script_id: options.scriptId } : {}),
      ...(options.projectTitle ? { project_title: options.projectTitle } : {}),
      ...(options.appVersion ? { app_version: options.appVersion } : {}),
      ...(options.backupKind ? { backup_kind: options.backupKind } : {}),
      ...(options.assetsOmitted ? { assets_omitted: true } : {}),
    },
    content,
    ...(options.assets && options.assets.length > 0 ? { assets: options.assets } : {}),
  };
  return JSON.stringify(data, null, 2);
}

/** Download a script as a .writea file. */
export async function downloadWritea(
  meta: ScriptMeta,
  content: Record<string, unknown>,
  options: ExportWriteaOptions = {},
): Promise<void> {
  const text = serializeWritea(meta, content, options);
  const filename = `${meta.title || 'Untitled'}.writea`;
  const { saveFile } = await import('./fileOps');
  await saveFile(text, filename, [{ name: 'WriTea Draft', extensions: ['writea'] }]);
}

/** Parse a .writea JSON string back into meta + content. */
export function parseWritea(jsonText: string): ParsedWritea {
  let data: any;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error('Invalid .writea file: not valid JSON');
  }

  if (data?.format !== 'writea-script') {
    throw new Error('Invalid .writea file: unrecognized format');
  }
  if (typeof data.writea_version !== 'number') {
    throw new Error('Invalid .writea file: missing version');
  }
  if (data.writea_version > WRITEA_VERSION) {
    throw new Error(
      `This .writea file was created by a newer version of WriTea Draft (format v${data.writea_version}). Update WriTea Draft to open it.`,
    );
  }

  return {
    version: data.writea_version,
    meta: {
      title: data.meta?.title || 'Untitled',
      author: data.meta?.author || '',
      color: data.meta?.color || '',
      page_count: data.meta?.page_count || 0,
      project_id: data.meta?.project_id ?? null,
      script_id: data.meta?.script_id ?? null,
      project_title: data.meta?.project_title,
      app_version: data.meta?.app_version,
      backup_kind: data.meta?.backup_kind,
      assets_omitted: data.meta?.assets_omitted === true,
    },
    content: data.content || {},
    assets: Array.isArray(data.assets) ? data.assets : [],
  };
}
