/**
 * Capability Grant Stores
 *
 * Different storage implementations for capability grants:
 * - Memory: For testing
 * - SQLite: For desktop (Tauri)
 * - Cloud: For web (with conflict resolution)
 *
 */

// Memory store (for tests)
export { MemoryGrantsStore, createMemoryGrantsStore } from './memory-store';

// SQLite store (for desktop)
export { SQLiteGrantsStore, createSQLiteGrantsStore } from './sqlite-store';
export type { ISQLiteDatabase } from './sqlite-store';

// Cloud store (for web)
export {
  CloudGrantsStore,
  // Vector clock utilities
  compareVectorClocks,
  createCloudGrantsStore,
  incrementVectorClock,
  mergeVectorClocks,
} from './cloud-store';
