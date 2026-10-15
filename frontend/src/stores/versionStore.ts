import { create } from 'zustand';

/**
 * One check-in of the open script: the whole script as it stood, compressed,
 * with the writer's message. Kept compressed in memory too, so saving the file
 * never has to recompress every earlier check-in.
 */
export interface StoredVersion {
  id: string;
  message: string;
  /** ISO timestamp. */
  date: string;
  /** 'gz' is gzip then base64; 'plain' is the JSON text, used where gzip is unavailable. */
  format: 'gz' | 'plain';
  data: string;
}

interface VersionState {
  versions: StoredVersion[];
  setVersions: (versions: StoredVersion[]) => void;
  addVersion: (version: StoredVersion) => void;
}

export const useVersionStore = create<VersionState>((set) => ({
  versions: [],
  setVersions: (versions) => set({ versions }),
  addVersion: (version) => set((s) => ({ versions: [...s.versions, version] })),
}));
