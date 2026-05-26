/**
 * App abstraction contracts for Spreadsheet OS.
 *
 * This module defines the interfaces that apps implement to integrate
 * with the Spreadsheet OS platform. Apps receive a sandboxed filesystem
 * scoped to /apps/{appId}/ and can declare data requirements.
 */

import type { IFileSystem } from '../filesystem';
import type { FilePath } from '../filesystem/paths';
import type { AppId as AppIdType } from '../filesystem/permissions';

// ============================================================
// App Identifier
// ============================================================

// Re-export AppId from filesystem permissions to ensure type compatibility
// across the codebase. The same branded type is used for both filesystem
// sandboxing and app identification.
export type AppId = AppIdType;

/**
 * Create an AppId from a plain string.
 * This is the contracts-local branded type constructor.
 * The runtime permission functions live in @mog-sdk/kernel.
 */
export function appId(id: string): AppId {
  return id as AppId;
}

// ============================================================
// Base App Interface
// ============================================================

/**
 * Base interface for all apps.
 *
 * Apps receive a sandboxed filesystem scoped to /apps/{appId}/
 * and interact with the kernel through well-defined contracts.
 *
 * @example
 * ```ts
 * class MyApp implements IApp {
 *   constructor(
 *     readonly id: AppId,
 *     readonly filesystem: IFileSystem
 *   ) {}
 * }
 * ```
 */
export interface IApp {
  /**
   * Unique identifier for this app.
   */
  readonly id: AppId;

  /**
   * Sandboxed filesystem scoped to /apps/{appId}/.
   * All path operations are relative to the app's root.
   */
  readonly filesystem: IFileSystem;
}

// ============================================================
// Document-Based Apps
// ============================================================

/**
 * Document-based apps work with a single active file at a time.
 *
 * Examples: Spreadsheet, Word Processor, Presentation
 *
 * The document model provides familiar Open/Save/Save As/Close semantics
 * similar to traditional desktop applications.
 *
 * @example
 * ```ts
 * class SpreadsheetApp implements IDocumentApp {
 *   // Open replaces the current document
 *   async open(path: FilePath): Promise<void> {
 *     if (this.isDirty) {
 *       // Prompt to save changes
 *     }
 *     this._currentDocument = await loadDocument(path);
 *   }
 * }
 * ```
 */
export interface IDocumentApp extends IApp {
  /**
   * The currently open document, or null if no document is open.
   */
  readonly currentDocument: IDocument | null;

  /**
   * Whether the current document has unsaved changes.
   */
  readonly isDirty: boolean;

  /**
   * Open a document from the filesystem.
   *
   * If a document is already open with unsaved changes, the app
   * should prompt the user to save or discard changes.
   *
   * @param path - Path to the document file
   */
  open(path: FilePath): Promise<void>;

  /**
   * Save the current document to its existing path.
   *
   * @throws Error if no document is open
   */
  save(): Promise<void>;

  /**
   * Save the current document to a new path.
   *
   * After saving, the new path becomes the document's path.
   *
   * @param path - New path for the document
   * @throws Error if no document is open
   */
  saveAs(path: FilePath): Promise<void>;

  /**
   * Close the current document.
   *
   * If the document has unsaved changes, the app should prompt
   * the user to save, discard, or cancel.
   *
   * @returns false if the user cancels the close operation, true otherwise
   */
  close(): Promise<boolean>;

  /**
   * Create a new empty document.
   *
   * If a document is already open with unsaved changes, the app
   * should prompt the user to save or discard changes.
   */
  newDocument(): Promise<void>;
}

/**
 * Metadata about an open document.
 */
export interface IDocument {
  /**
   * Path to the document file.
   */
  readonly path: FilePath;

  /**
   * Display name for the document (typically the filename).
   */
  readonly name: string;

  /**
   * Whether the document has unsaved changes.
   */
  readonly isDirty: boolean;

  /**
   * Last modification timestamp (milliseconds since epoch).
   */
  readonly lastModified: number;
}

// ============================================================
// Project-Based Apps
// ============================================================

/**
 * Project-based apps work with multiple open files simultaneously.
 *
 * Examples: CRM, Database, File Manager, IDE
 *
 * The project model allows multiple files to be open at once,
 * with tab-based or tree-based navigation between them.
 *
 * @example
 * ```ts
 * class CRMApp implements IProjectApp {
 *   // Open multiple files at once
 *   async loadCustomer(id: string) {
 *     const handle = await this.openFile(filePath(`customers/${id}.json`));
 *     // File is now available in openFiles map
 *   }
 * }
 * ```
 */
export interface IProjectApp extends IApp {
  /**
   * Map of currently open files, keyed by their path.
   */
  readonly openFiles: ReadonlyMap<FilePath, IFileHandle>;

  /**
   * Open a file and add it to the open files set.
   *
   * If the file is already open, returns the existing handle.
   *
   * @param path - Path to the file
   * @returns Handle to the open file
   */
  openFile(path: FilePath): Promise<IFileHandle>;

  /**
   * Close a file and remove it from the open files set.
   *
   * If the file has unsaved changes, the app should prompt
   * the user to save or discard changes.
   *
   * @param path - Path to the file to close
   */
  closeFile(path: FilePath): Promise<void>;

  /**
   * Save a specific open file.
   *
   * @param path - Path to the file to save
   * @throws Error if the file is not open
   */
  saveFile(path: FilePath): Promise<void>;

  /**
   * Save all open files with unsaved changes.
   */
  saveAll(): Promise<void>;
}

/**
 * Handle to an open file in project-based apps.
 */
export interface IFileHandle {
  /**
   * Path to the file.
   */
  readonly path: FilePath;

  /**
   * Whether the file has unsaved changes.
   */
  readonly isDirty: boolean;

  /**
   * Last modification timestamp (milliseconds since epoch).
   */
  readonly lastModified: number;
}

// ============================================================
// App Manifest
// ============================================================

/**
 * App manifest for registration with the kernel.
 *
 * The manifest declares the app's metadata, file associations,
 * and data requirements.
 *
 * @example
 * ```ts
 * const manifest: AppManifest = {
 *   id: appId('spreadsheet'),
 *   name: 'Spreadsheet',
 *   version: '1.0.0',
 *   description: 'A powerful spreadsheet application',
 *   fileExtensions: ['.xlsx', '.xls', '.csv'],
 * };
 * ```
 */
export interface AppManifest {
  /**
   * Unique identifier for the app.
   */
  id: AppId;

  /**
   * Display name for the app.
   */
  name: string;

  /**
   * Semantic version string (e.g., "1.0.0").
   */
  version: string;

  /**
   * Optional description of the app.
   */
  description?: string;

  /**
   * Optional icon path or data URL.
   */
  icon?: string;

  /**
   * File extensions this app can open (for document apps).
   *
   * @example ['.xlsx', '.xls', '.csv']
   */
  fileExtensions?: string[];

  /**
   * Data requirements for this app.
   *
   * Declares what tables the app needs and their schemas.
   * Users configure connections to satisfy these requirements.
   */
  dataRequirements?: AppDataRequirements;
}

// ============================================================
// Data Requirements
// ============================================================

/**
 * Data requirements declaration for an app.
 *
 * Apps declare what tables they need; users configure connections
 * to satisfy the requirements (local storage, external database, etc.).
 *
 * @example
 * ```ts
 * const requirements: AppDataRequirements = {
 *   contacts: {
 *     schema: {
 *       columns: [
 *         { name: 'name', type: 'string', required: true },
 *         { name: 'email', type: 'string', required: true },
 *         { name: 'phone', type: 'string' },
 *       ],
 *     },
 *     required: true,
 *     defaultConnection: 'local',
 *   },
 *   orders: {
 *     schema: orderSchema,
 *     required: true,
 *     // No default - user must configure
 *   },
 * };
 * ```
 */
export interface AppDataRequirements {
  /**
   * Map of table keys to their requirements.
   * The key is the app's internal name for the table.
   */
  [tableKey: string]: TableRequirement;
}

/**
 * Requirement for a single table.
 */
export interface TableRequirement {
  /**
   * Schema definition for the table.
   */
  schema: TableSchemaDefinition;

  /**
   * Whether this table is required for the app to function.
   */
  required: boolean;

  /**
   * Default connection to suggest to the user.
   *
   * - 'local': Suggest local Yjs storage (data in workbook file)
   * - string: Suggest a specific connection ID
   * - undefined: User must explicitly configure
   */
  defaultConnection?: 'local' | string;
}

/**
 * Schema definition for a table.
 *
 * Describes the expected structure of the table's data.
 */
export interface TableSchemaDefinition {
  /**
   * Column definitions for the table.
   */
  columns: TableColumnDefinition[];
}

/**
 * Definition for a single column in a table schema.
 */
export interface TableColumnDefinition {
  /**
   * Column name.
   */
  name: string;

  /**
   * Data type for the column.
   */
  type: TableColumnType;

  /**
   * Whether this column is required (not nullable).
   * @default false
   */
  required?: boolean;
}

/**
 * Supported column data types.
 */
export type TableColumnType = 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'json';
