/**
 * Schema Browser Slice
 *
 * Manages state for the Schema Browser panel, which displays
 * database tables and columns for a selected connection.
 *
 * Schema data is provided by the app data-tools state.
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Schema Types
// =============================================================================

export interface ColumnSchema {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey?: boolean;
  comment?: string;
  defaultValue?: string;
}

export interface TableSchema {
  name: string;
  schema?: string;
  columns: ColumnSchema[];
  rowCount?: number;
  comment?: string;
}

export interface SchemaData {
  tables: TableSchema[];
  fetchedAt: number;
}

// =============================================================================
// Slice State & Actions
// =============================================================================

export interface SchemaBrowserState {
  /** Whether the schema browser panel is open */
  isOpen: boolean;
  /** The connection ID whose schema is being browsed */
  selectedConnectionId: string | null;
  /** Cached schema data */
  schema: SchemaData | null;
  /** Whether schema is currently loading */
  isLoading: boolean;
  /** Error message from the last fetch attempt */
  error: string | null;
}

export interface SchemaBrowserSlice {
  /** Schema Browser panel state (nested to avoid property name collisions) */
  schemaBrowser: SchemaBrowserState;
  openSchemaBrowser: (connectionId?: string) => void;
  closeSchemaBrowser: () => void;
  selectSchemaBrowserConnection: (connectionId: string) => void;
  setSchemaBrowserSchema: (schema: SchemaData) => void;
  setSchemaBrowserLoading: (isLoading: boolean) => void;
  setSchemaBrowserError: (error: string | null) => void;
}

const initialState: SchemaBrowserState = {
  isOpen: false,
  selectedConnectionId: null,
  schema: null,
  isLoading: false,
  error: null,
};

export const createSchemaBrowserSlice: StateCreator<
  SchemaBrowserSlice,
  [],
  [],
  SchemaBrowserSlice
> = (set) => ({
  schemaBrowser: initialState,

  openSchemaBrowser: (connectionId?: string) => {
    const hasConnection = !!connectionId;
    set({
      schemaBrowser: {
        isOpen: true,
        selectedConnectionId: connectionId || null,
        // Reset data state when opening with a new connection
        schema: null,
        isLoading: hasConnection,
        error: null,
      },
    });
  },

  closeSchemaBrowser: () => {
    set({ schemaBrowser: initialState });
  },

  selectSchemaBrowserConnection: (connectionId: string) => {
    set({
      schemaBrowser: {
        isOpen: true,
        selectedConnectionId: connectionId,
        schema: null,
        isLoading: true,
        error: null,
      },
    });
  },

  setSchemaBrowserSchema: (schema: SchemaData) => {
    set((s) => ({
      schemaBrowser: {
        ...s.schemaBrowser,
        schema,
        isLoading: false,
        error: null,
      },
    }));
  },

  setSchemaBrowserLoading: (isLoading: boolean) => {
    set((s) => ({
      schemaBrowser: {
        ...s.schemaBrowser,
        isLoading,
        // Clear stale error/schema when starting a new load
        ...(isLoading && { error: null, schema: null }),
      },
    }));
  },

  setSchemaBrowserError: (error: string | null) => {
    set((s) => ({
      schemaBrowser: {
        ...s.schemaBrowser,
        error,
        isLoading: false,
      },
    }));
  },
});
