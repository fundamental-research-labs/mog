/**
 * IPC contract types for Tauri commands.
 *
 * These types define the interface between TypeScript and Rust commands
 * in src-tauri/src/commands/. They must be kept in sync with the Rust
 * function signatures.
 */

// ============================================================
// File Operations
// ============================================================

/**
 * Parameters for read_file command.
 */
export interface ReadFileParams {
  path: string;
}

/**
 * Parameters for write_file command.
 */
export interface WriteFileParams {
  path: string;
  data: number[]; // Uint8Array serialized as array
}

/**
 * Parameters for delete_path command.
 */
export interface DeletePathParams {
  path: string;
  move_to_trash: boolean;
}

/**
 * Parameters for rename_path command.
 */
export interface RenamePathParams {
  old_path: string;
  new_path: string;
}

/**
 * Parameters for copy_file command.
 */
export interface CopyFileParams {
  source: string;
  dest?: string;
}

// ============================================================
// Directory Operations
// ============================================================

/**
 * Parameters for create_folder command.
 */
export interface CreateFolderParams {
  path: string;
}

/**
 * Parameters for generate_unique_folder_name command.
 */
export interface GenerateUniqueFolderNameParams {
  directory: string;
  base_name: string;
}

/**
 * Parameters for generate_unique_filename command.
 */
export interface GenerateUniqueFilenameParams {
  directory: string;
  base_name: string;
  extension: string;
}

/**
 * Parameters for import_files command.
 */
export interface ImportFilesParams {
  source_paths: string[];
  target_directory: string;
}

// ============================================================
// Spreadsheet Operations
// ============================================================

/**
 * Parameters for create_empty_spreadsheet command.
 */
export interface CreateEmptySpreadsheetParams {
  path: string;
}

/**
 * Parameters for import_xlsx command.
 */
export interface ImportXlsxParams {
  filePath: string;
  [key: string]: unknown;
}

/** Parsed XLSX workbook from Rust parser — shape defined by Rust IPC output */
export type ImportXlsxResult = Record<string, unknown>;

/**
 * Parameters for export_xlsx command.
 */
export interface ExportXlsxParams {
  filePath: string;
  docId: string;
  [key: string]: unknown;
}

// ============================================================
// Dialog Types
// ============================================================

/**
 * File filter for native file dialogs.
 */
export interface FileFilter {
  name: string;
  extensions: string[];
}

/**
 * Parameters for show_open_dialog command.
 */
export interface OpenDialogParams {
  filters: FileFilter[];
}

/**
 * Parameters for show_save_dialog command.
 */
export interface SaveDialogParams {
  default_name?: string;
  filters: FileFilter[];
}

// ============================================================
// Recent Files
// ============================================================

/**
 * Recent file entry stored by the application.
 */
export interface RecentFile {
  path: string;
  name: string;
  timestamp: number;
}

// ============================================================
// File Metadata (Not yet implemented in Rust)
// ============================================================

/**
 * File metadata returned by stat operations.
 * Note: This requires a get_file_metadata Rust command to be implemented.
 */
export interface FileMetadata {
  size: number;
  created: number;
  modified: number;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
}

/**
 * Directory entry returned by list operations.
 * Note: This requires a list_directory Rust command to be implemented.
 */
export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
}
