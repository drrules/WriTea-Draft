import type { LocationEntry } from '../stores/locationStore';

/** Parse location name from a scene heading string. */
const PREFIX_RE = /^(INT\.?\/?EXT\.?|EXT\.?\/?INT\.?|INT\.?|EXT\.?|I\/E\.?)\s+/i;
const TIME_WORDS = 'DAY|NIGHT|DAWN|DUSK|MORNING|AFTERNOON|EVENING|SUNSET|SUNRISE|LATER|CONTINUOUS|SAME TIME|MOMENTS LATER|SAME|MAGIC HOUR';

export function parseLocationFromHeading(heading: string): string {
  let rest = heading.trim();
  const prefix = rest.match(PREFIX_RE);
  if (prefix && prefix.index !== undefined) rest = rest.slice(prefix.index + prefix[0].length);
  const dashTime = rest.match(new RegExp(`\\s+-\\s+(${TIME_WORDS})\\.?$`, 'i'));
  if (dashTime) rest = rest.slice(0, -dashTime[0].length);
  else {
    const dotTime = rest.match(new RegExp(`\\.\\s*(${TIME_WORDS})\\.?$`, 'i'));
    if (dotTime) rest = rest.slice(0, -dotTime[0].length);
  }
  return rest.replace(/^[\s.]+|[\s.]+$/g, '').toUpperCase();
}

export function newLocationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `loc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newLocationEntry(name: string, type: LocationEntry['type'] = 'interior'): LocationEntry {
  return {
    id: newLocationId(),
    name,
    fullName: '',
    type,
    address: '',
    notes: '',
    contact: '',
    availability: '',
    tags: [],
    aliases: [],
  };
}

function typeOfHeading(heading: string): LocationEntry['type'] {
  const h = heading.trim();
  if (/^(INT\.?\/?EXT|EXT\.?\/?INT|I\/E)/i.test(h)) return 'both';
  if (/^EXT/i.test(h)) return 'exterior';
  return 'interior';
}

/**
 * One new entry for each place in the scene headings that the list does not
 * already know by name or alias. A place seen both inside and outside is "both".
 */
export function discoverLocationEntries(headings: string[], existing: LocationEntry[]): LocationEntry[] {
  const known = new Set<string>();
  for (const l of existing) {
    known.add(l.name);
    l.aliases.forEach((a) => known.add(a));
  }
  const found = new Map<string, LocationEntry['type']>();
  for (const heading of headings) {
    const name = parseLocationFromHeading(heading);
    if (!name || known.has(name)) continue;
    const type = typeOfHeading(heading);
    const prev = found.get(name);
    found.set(name, prev && prev !== type ? 'both' : type);
  }
  return Array.from(found, ([name, type]) => newLocationEntry(name, type));
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** Whatever was stored, turned into a clean list; anything unusable is dropped. */
export function sanitizeLocations(raw: unknown): LocationEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: LocationEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const name = str(r.name).trim().toUpperCase();
    if (!name) continue;
    out.push({
      id: str(r.id) || newLocationId(),
      name,
      fullName: str(r.fullName),
      type: r.type === 'exterior' || r.type === 'both' ? r.type : 'interior',
      address: str(r.address),
      notes: str(r.notes),
      contact: str(r.contact),
      availability: str(r.availability),
      tags: strList(r.tags),
      aliases: strList(r.aliases),
    });
  }
  return out;
}

/** True when the writer has recorded anything beyond a bare name and type. */
export function locationHasDetails(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const r = entry as Record<string, unknown>;
  const text = ['fullName', 'address', 'notes', 'contact', 'availability'].some((k) => str(r[k]).trim() !== '');
  return text || strList(r.tags).length > 0 || strList(r.aliases).length > 0;
}
