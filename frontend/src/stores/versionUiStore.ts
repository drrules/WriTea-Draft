import { create } from 'zustand';

/** Whether the Version History panel is open. */
interface VersionUiState {
  versionHistoryOpen: boolean;
  setVersionHistoryOpen: (open: boolean) => void;
}

export const useVersionUiStore = create<VersionUiState>((set) => ({
  versionHistoryOpen: false,
  setVersionHistoryOpen: (open) => set({ versionHistoryOpen: open }),
}));
