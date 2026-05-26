import type { StateCreator } from 'zustand';

export interface WorkbookLinksPanelState {
  isOpen: boolean;
  selectedLinkId: string | null;
  tab: 'links' | 'diagnostics';
  filter: string;
}

export interface WorkbookLinksPanelSlice {
  workbookLinksPanel: WorkbookLinksPanelState;
  openWorkbookLinksPanel: () => void;
  closeWorkbookLinksPanel: () => void;
  selectWorkbookLink: (linkId: string | null) => void;
  setWorkbookLinksPanelTab: (tab: 'links' | 'diagnostics') => void;
  setWorkbookLinksPanelFilter: (filter: string) => void;
}

const initialState: WorkbookLinksPanelState = {
  isOpen: false,
  selectedLinkId: null,
  tab: 'links',
  filter: '',
};

export const createWorkbookLinksPanelSlice: StateCreator<
  WorkbookLinksPanelSlice,
  [],
  [],
  WorkbookLinksPanelSlice
> = (set) => ({
  workbookLinksPanel: initialState,
  openWorkbookLinksPanel: () => {
    set((s) => ({
      workbookLinksPanel: {
        ...s.workbookLinksPanel,
        isOpen: true,
      },
    }));
  },
  closeWorkbookLinksPanel: () => set({ workbookLinksPanel: initialState }),
  selectWorkbookLink: (linkId: string | null) => {
    set((s) => ({
      workbookLinksPanel: {
        ...s.workbookLinksPanel,
        selectedLinkId: linkId,
      },
    }));
  },
  setWorkbookLinksPanelTab: (tab: 'links' | 'diagnostics') => {
    set((s) => ({
      workbookLinksPanel: {
        ...s.workbookLinksPanel,
        tab,
      },
    }));
  },
  setWorkbookLinksPanelFilter: (filter: string) => {
    set((s) => ({
      workbookLinksPanel: {
        ...s.workbookLinksPanel,
        filter,
      },
    }));
  },
});
