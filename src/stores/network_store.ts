/// Stores everything that is the kinda static network

import { create } from "zustand";

interface NetworkState {
  dummy: number;
  updateDummy: (newDummy: number) => void;
}

export const useNetworkStore = create<NetworkState>()((set) => ({
  dummy: 0,
  updateDummy: (newDummy) => set({ dummy: newDummy }),
}));
