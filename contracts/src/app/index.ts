/**
 * App abstraction contracts for Spreadsheet OS.
 *
 * Provides interfaces for building apps on the Spreadsheet OS platform:
 * - IApp: Base interface for all apps with sandboxed filesystem
 * - IDocumentApp: Single-document apps (Spreadsheet, Word Processor)
 * - IProjectApp: Multi-file apps (CRM, Database, File Manager)
 * - AppManifest: App registration and metadata
 */

// App identifier
export { appId } from './types';
export type { AppId } from './types';

// Base app interface
export type { IApp } from './types';

// Document-based apps
export type { IDocument, IDocumentApp } from './types';

// Project-based apps
export type { IFileHandle, IProjectApp } from './types';

// App manifest and registration
export type { AppManifest } from './types';

// Data requirements
export type {
  AppDataRequirements,
  TableColumnDefinition,
  TableColumnType,
  TableRequirement,
  TableSchemaDefinition,
} from './types';
