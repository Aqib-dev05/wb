import { create } from 'zustand';
import { DEFAULTS } from '../canvas/constants.js';

const initial = () => ({
  tool: 'select',
  selection: null, // { count, caps, values } | null
  defaults: { ...DEFAULTS },
  history: { canUndo: false, canRedo: false },
  viewport: { zoom: 1 },
  sync: { status: 'connecting', pending: 0 }, // status: connecting | live | offline | denied | closed
  participants: [], // other people on the board right now
  libraryOpen: false, // shapes / icons / logos panel
  panelOpen: typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : true,
});

export const useEditorStore = create((set) => ({
  ...initial(),
  reset: () => set(initial()),
  setTool: (tool) => set({ tool }),
  setSelection: (selection) => set({ selection }),
  setDefaults: (defaults) => set({ defaults }),
  setHistory: (history) => set({ history }),
  setViewport: (viewport) => set({ viewport }),
  setSync: (patch) => set((s) => ({ sync: { ...s.sync, ...patch } })),
  setParticipants: (participants) => set({ participants }),
  toggleLibrary: (open) => set((s) => ({ libraryOpen: open ?? !s.libraryOpen })),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
}));
