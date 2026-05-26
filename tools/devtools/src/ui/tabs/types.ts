import type {
  CellSnapshotData,
  DevToolsStatus,
  MachineSnapshot,
  SceneGraphSnapshotData,
  StoreEntry,
  ViewportSnapshotData,
} from '../../types';

// ---------------------------------------------------------------------------
// Data source interface
//
// Shared between DevToolsPanel and its tab components. Lives in this file
// (rather than on DevToolsPanel.tsx) so tabs can import the type without
// creating a cycle back to the panel.
// ---------------------------------------------------------------------------

export interface DevToolsDataSource {
  subscribe(listener: () => void): () => void;
  getStatus(): DevToolsStatus | null;
  toJSON(): { events: StoreEntry[]; machines: Record<string, MachineSnapshot> } | null;
  enable(): void;
  disable(): void;
  clear(): void;
  // Snapshot queries
  requestViewportSnapshot(): void;
  requestSceneGraphSnapshot(): void;
  requestCellSnapshot(row: number, col: number, viewportId?: string): void;
  getViewportSnapshot(): ViewportSnapshotData | null;
  getSceneGraphSnapshot(): SceneGraphSnapshotData | null;
  getCellSnapshot(): CellSnapshotData | null;
}
