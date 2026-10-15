import { create } from 'zustand';

/** One place in the script, with whatever the writer has noted about it. */
export interface LocationEntry {
  id: string;
  name: string;
  fullName: string;
  type: 'interior' | 'exterior' | 'both';
  address: string;
  notes: string;
  contact: string;
  availability: string;
  tags: string[];
  aliases: string[];
}

interface LocationState {
  locations: LocationEntry[];
  setLocations: (locations: LocationEntry[]) => void;
}

/** The open script's locations. They are saved inside the script file. */
export const useLocationStore = create<LocationState>((set) => ({
  locations: [],
  setLocations: (locations) => set({ locations }),
}));
