/**
 * App Kernel API - Public Exports
 *
 * This module exports the types and interfaces that apps use to interact
 * with the spreadsheet kernel.
 *
 */

// Types
export type {
  AppCellError,
  // Value Types
  AppCellValue,
  AppCellValuePrimitive,
  AppColumnId,
  AppColumnInfo,
  AppColumnSchema,
  AppColumnType,
  // Column Types
  AppColumnTypeKind,
  AppFilter,
  AppFilterCondition,
  // Query Types
  AppFilterOperator,
  AppQueryOptions,
  // Record Types
  AppRecord,
  AppSelectOption,
  AppSortConfig,
  AppSortDirection,
  AppTableId,
  // Table Types
  AppTableInfo,
  AppTableSchema,
  // ID Types
  RecordId,
  // Utility Types
  Unsubscribe,
} from './types';

// API Interfaces
export type {
  // Clipboard
  AppClipboardPayload,
  AppClipboardSnapshot,
  AppContext,
  // Context
  AppManifest,
  // Bindings API
  IAppBindingsAPI,
  IAppClipboardAPI,
  IAppColumnsAPI,
  IAppEventsAPI,
  // Main API
  IAppKernelAPI,
  IAppRecordsAPI,
  IAppRelationsAPI,
  // Sub-API Interfaces
  IAppTablesAPI,
  // Event Types
  RecordChangeEvent,
  RecordChangeHandler,
  // Relations
  RelationLink,
  TableSchemaChangeEvent,
  TableSchemaChangeHandler,
} from './api';

// Binding Types
export type {
  AppInstance,
  ColumnMapping,
  ResolvedBindings,
  ResolvedTableBinding,
  TableBinding,
} from './bindings';

// View Contribution Types
export type { ViewContribution, ViewProps } from './views';
