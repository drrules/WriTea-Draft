import { describe, it, expect } from 'vitest';
import { isImportableExtension, importFormatLabel, SCREENPLAY_IMPORT_ACCEPT } from './importScreenplay';

describe('.writea is a first-class openable format', () => {
  it('is accepted by import, drag and drop and the file pickers', () => {
    expect(isImportableExtension('writea')).toBe(true);
    expect(SCREENPLAY_IMPORT_ACCEPT).toContain('.writea');
  });
  it('has a readable name', () => {
    expect(importFormatLabel('writea')).toBe('WriTea Draft (.writea)');
  });
});
