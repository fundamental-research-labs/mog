/**
 * Project Slice
 *
 * State management for project folder and open files.
 * Dumb store - no business logic, just state and setters.
 */

import type { StateCreator } from 'zustand';
import type { FileMetadata, ProjectFileEntry, RecentProject } from '../../services/project/types';

/**
 * Project state
 */
export interface ProjectState {
  // Project state
  projectPath: string | null;
  projectName: string | null;
  fileTree: ProjectFileEntry[];
  singleFileMode: boolean;

  // Open files state
  openFileIds: string[];
  activeFileId: string | null;
  files: Record<string, FileMetadata>;

  // Loading state
  isLoading: boolean;

  // Recent projects
  recentProjects: RecentProject[];
}

export interface ProjectSlice extends ProjectState {
  // Project setters (pure, no side effects)
  setProject: (path: string | null, name: string | null) => void;
  setFileTree: (tree: ProjectFileEntry[]) => void;
  setSingleFileMode: (mode: boolean) => void;
  setIsLoading: (loading: boolean) => void;
  setRecentProjects: (projects: RecentProject[]) => void;

  // File setters
  addFile: (file: FileMetadata) => void;
  updateFile: (id: string, updates: Partial<FileMetadata>) => void;
  removeFile: (id: string) => void;

  // Open files setters
  setOpenFileIds: (ids: string[]) => void;
  addOpenFileId: (id: string) => void;
  removeOpenFileId: (id: string) => void;
  setActiveFileId: (id: string | null) => void;

  // Reset
  resetProject: () => void;
}

const initialProjectState: ProjectState = {
  projectPath: null,
  projectName: null,
  fileTree: [],
  singleFileMode: false,
  openFileIds: [],
  activeFileId: null,
  files: {},
  isLoading: false,
  recentProjects: [],
};

export const createProjectSlice: StateCreator<ProjectSlice, [], [], ProjectSlice> = (set) => ({
  ...initialProjectState,

  // Project setters
  setProject: (path, name) => set({ projectPath: path, projectName: name }),
  setFileTree: (tree) => set({ fileTree: tree }),
  setSingleFileMode: (mode) => set({ singleFileMode: mode }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setRecentProjects: (projects) => set({ recentProjects: projects }),

  // File setters
  addFile: (file) => set((s) => ({ files: { ...s.files, [file.id]: file } })),
  updateFile: (id, updates) =>
    set((s) => {
      const existing = s.files[id];
      if (!existing) return s;
      return { files: { ...s.files, [id]: { ...existing, ...updates } } };
    }),
  removeFile: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.files;
      return { files: rest };
    }),

  // Open files setters
  setOpenFileIds: (ids) => set({ openFileIds: ids }),
  addOpenFileId: (id) => set((s) => ({ openFileIds: [...s.openFileIds, id] })),
  removeOpenFileId: (id) => set((s) => ({ openFileIds: s.openFileIds.filter((i) => i !== id) })),
  setActiveFileId: (id) => set({ activeFileId: id }),

  // Reset
  resetProject: () => set(initialProjectState),
});
