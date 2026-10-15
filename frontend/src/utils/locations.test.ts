import { describe, it, expect } from 'vitest';
import {
  parseLocationFromHeading, discoverLocationEntries, sanitizeLocations,
  locationHasDetails, newLocationEntry,
} from './locations';
import { writeaOnlyContent } from './writeaOnly';

describe('locations', () => {
  it('reads the place out of a scene heading', () => {
    expect(parseLocationFromHeading('INT. KITCHEN - DAY')).toBe('KITCHEN');
    expect(parseLocationFromHeading('EXT. OLD DOCK - NIGHT')).toBe('OLD DOCK');
  });

  it('discovers new places and merges inside and outside into both', () => {
    const found = discoverLocationEntries(
      ['INT. KITCHEN - DAY', 'EXT. KITCHEN - NIGHT', 'INT. HALL - DAY'],
      [],
    );
    expect(found.map((l) => [l.name, l.type])).toEqual([['KITCHEN', 'both'], ['HALL', 'interior']]);
  });

  it('skips places already known by name or alias', () => {
    const existing = [{ ...newLocationEntry('KITCHEN'), aliases: ['GALLEY'] }];
    const found = discoverLocationEntries(['INT. KITCHEN - DAY', 'INT. GALLEY - DAY', 'INT. HALL - DAY'], existing);
    expect(found.map((l) => l.name)).toEqual(['HALL']);
  });

  it('cleans up whatever was stored', () => {
    expect(sanitizeLocations('nope')).toEqual([]);
    const out = sanitizeLocations([{ name: ' attic ', type: 'weird', tags: ['a', 3] }, { name: '' }, null]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('ATTIC');
    expect(out[0].type).toBe('interior');
    expect(out[0].tags).toEqual(['a']);
  });

  it('only counts real details as WriTea-only content', () => {
    expect(locationHasDetails(newLocationEntry('ATTIC'))).toBe(false);
    expect(locationHasDetails({ ...newLocationEntry('ATTIC'), address: '1 Main St' })).toBe(true);
    expect(writeaOnlyContent({ _locations: [newLocationEntry('ATTIC')] })).toEqual([]);
    expect(writeaOnlyContent({ _locations: [{ ...newLocationEntry('ATTIC'), notes: 'creaky' }] })).toContain('location details');
  });
});
