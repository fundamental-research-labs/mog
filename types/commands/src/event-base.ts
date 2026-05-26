/**
 * Base Event Types
 *
 * Shared base types for all event definitions.
 * Extracted to break circular dependency:
 * - connections.ts needs BaseEvent
 * - sorting.ts needs BaseEvent
 * - events.ts needs to import from connections.ts and sorting.ts
 */

/**
 * Identifies the source of a state change
 */
export type CellChangeSource =
  | 'user' // Direct user interaction (typing, paste, etc.)
  | 'formula' // Formula recalculation
  | 'import' // File import (XLSX, CSV)
  | 'api' // Programmatic API call
  | 'remote'; // Remote collaboration sync

/**
 * Identifies the source of a structural change
 */
export type StructureChangeSource = 'user' | 'import' | 'api' | 'remote' | 'system';

/**
 * Base interface for all events
 */
export interface BaseEvent {
  /** Event type identifier */
  type: string;
  /** When the event occurred (ms since epoch) */
  timestamp: number;
  /** Sheet this event applies to (if applicable) */
  sheetId?: string;
  /** Transaction ID for grouping related events */
  transactionId?: string;
}
