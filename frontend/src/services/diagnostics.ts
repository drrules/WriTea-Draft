/**
 * Diagnostics: collect runtime info that is useful when triaging bug reports.
 *
 * Surfaces OS, app version, the app data folder, and OneDrive interference
 * detection (Windows). Rendered by the Help > Diagnostics dialog.
 */

import { getCompatEntries } from './compat';
import { isDesktopTauri } from './platform';

export interface DiagnosticsReport {
  appVersion: string;
  os: string;
  userAgent: string;
  appDataDir: string | null;
  oneDriveSuspect: boolean;
  compat: Array<{ label: string; mode: string; using: string; errorReason?: string }>;
  collectedAt: string;
}

/** Best-effort OS string from the user-agent. */
function detectOs(): string {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  if (/Windows NT 10\.0; Win64; x64/.test(ua)) return 'Windows 10/11 (x64)';
  if (/Windows NT 10\.0/.test(ua)) return 'Windows 10/11';
  if (/Windows NT/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) {
    const m = ua.match(/Mac OS X ([0-9_]+)/);
    return m ? `macOS ${m[1].replace(/_/g, '.')}` : 'macOS';
  }
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iOS/.test(ua)) return 'iOS';
  if (/Linux/.test(ua)) return 'Linux';
  return ua.slice(0, 200) || 'unknown';
}

/**
 * Heuristic check for OneDrive interference on Windows. Returns true if the
 * app data directory path suggests it's under a OneDrive-synced folder.
 *
 * Cloud sync can grab a file mid-write, which shows up as a silent save
 * failure. Worth flagging.
 */
export function isUnderOneDrive(path: string | null): boolean {
  if (!path) return false;
  // Common OneDrive path patterns on Windows:
  //   C:\Users\<name>\OneDrive\...
  //   C:\Users\<name>\OneDrive - <Org>\...
  return /[\\/]OneDrive([\\/ ]|$)/i.test(path);
}

/** Collect a snapshot of diagnostic info. Safe to call from web (returns reduced data). */
export async function collectDiagnostics(): Promise<DiagnosticsReport> {
  const os = detectOs();

  let appDataDir: string | null = null;
  if (isDesktopTauri()) {
    try {
      const path = await import('@tauri-apps/api/path');
      appDataDir = await path.appDataDir();
    } catch (err) {
      appDataDir = `(unavailable: ${(err as Error).message || err})`;
    }
  }

  const oneDriveSuspect = /Windows/i.test(os) && isUnderOneDrive(appDataDir);

  return {
    appVersion: getAppVersion(),
    os,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a',
    appDataDir,
    oneDriveSuspect,
    compat: getCompatEntries().map((e) => ({
      label: e.label,
      mode: e.mode,
      using: e.using,
      errorReason: e.errorReason,
    })),
    collectedAt: new Date().toISOString(),
  };
}

export function getAppVersion(): string {
  // Version is hard-coded in MenuBar/About; pull from a global if exposed,
  // otherwise rely on what the Tauri build embeds.
  if (typeof window !== 'undefined' && (window as any).__WRITEADRAFT_VERSION__) {
    return (window as any).__WRITEADRAFT_VERSION__;
  }
  return '1.0.42';
}

/** Format a report as plain text suitable for pasting into a bug report. */
export function formatReport(r: DiagnosticsReport): string {
  const lines: string[] = [];
  lines.push(`WriTea Draft Diagnostics (${r.collectedAt})`);
  lines.push(`Version: ${r.appVersion}`);
  lines.push(`OS: ${r.os}`);
  if (r.appDataDir) lines.push(`App data dir: ${r.appDataDir}`);
  if (r.oneDriveSuspect) {
    lines.push('');
    lines.push('Warning: OneDrive interference suspected. The app data directory appears to');
    lines.push('  be under a OneDrive-synced folder. OneDrive can lock or sync files');
    lines.push('  mid-write, causing silent save failures. Consider moving');
    lines.push('  C:\\Users\\<you>\\AppData out of OneDrive sync, or excluding the');
    lines.push('  WriTea Draft data folder from OneDrive.');
  }
  lines.push('');
  lines.push('Compatibility:');
  for (const c of r.compat) {
    lines.push(`  - ${c.label}: ${c.mode} (${c.using})${c.errorReason ? `, ${c.errorReason}` : ''}`);
  }
  lines.push('');
  lines.push(`User-Agent: ${r.userAgent}`);
  return lines.join('\n');
}
