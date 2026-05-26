import { create } from 'zustand';

interface KeyboardShortcutsDialogState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

/**
 * Small Zustand store for the keyboard shortcuts dialog visibility.
 * This enables the self-subscribing pattern used by other dialogs without
 * forcing action handlers to import the React dialog component.
 */
export const useKeyboardShortcutsDialogStore = create<KeyboardShortcutsDialogState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
}));
