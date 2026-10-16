/**
 * Custom formatting templates are kept in this machine's local storage.
 * Reads never throw: a missing or damaged entry just means no custom templates.
 */
const KEY = 'writeadraft:formatting-templates';

export function loadStoredTemplates(): unknown[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStoredTemplates(templates: unknown[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(templates));
  } catch (err) {
    console.warn('[templates] could not save custom templates', err);
  }
}
