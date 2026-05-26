/**
 * Typed IPC wrapper for Tauri commands
 *
 * Provides a type-safe interface to all Rust backend commands.
 * Use this instead of calling `invoke` directly.
 *
 * Commands with security middleware use `secureInvoke` for HMAC signing.
 * Public commands (dialogs, preferences, autosave, etc.) use plain `invoke`.
 */

import { invoke } from '@tauri-apps/api/core';
import type { ExportXlsxParams, ImportXlsxParams, ImportXlsxResult } from '../contracts';
import { secureInvoke } from '../secure-invoke';
// TODO: Import from shared types once contracts are migrated
// import type {
//   IpcClient,
//   RecentFile,
//   RecentProject,
//   FileFilter,
//   WindowState,
//   AutosaveEntry,
//   ProjectCommands,
//   ProjectFileEntry,
//   FileOperationCommands,
//   RecentProjectsCommands
// } from '../../types/contracts';

// Temporary inline types until contracts are migrated
export interface RecentFile {
  path: string;
  name: string;
  openedAt: number;
}

export interface RecentProject {
  path: string;
  name: string;
  openedAt: number;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface AutosaveEntry {
  id: string;
  originalPath?: string;
  displayName?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectFileEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  extension?: string;
  children?: ProjectFileEntry[];
}

export interface IpcClient {
  read_file: (args: { path: string }) => Promise<Uint8Array>;
  write_file: (args: { path: string; data: number[] }) => Promise<void>;
  show_open_dialog: (args: { filters: FileFilter[] }) => Promise<string | null>;
  show_save_dialog: (args: {
    defaultName?: string;
    filters: FileFilter[];
  }) => Promise<string | null>;
  get_recent_files: () => Promise<RecentFile[]>;
  add_recent_file: (args: { file: RecentFile }) => Promise<void>;
  clear_recent_files: () => Promise<void>;
  get_preference: (args: { key: string }) => Promise<string | null>;
  set_preference: (args: { key: string; value: string }) => Promise<void>;
  get_window_state: () => Promise<WindowState>;
  save_window_state: (args: { state: WindowState }) => Promise<void>;
  get_app_data_dir: () => Promise<string>;
  get_autosave_dir: () => Promise<string>;
  list_autosave_files: () => Promise<AutosaveEntry[]>;
  create_autosave: (args: {
    data: number[];
    originalPath?: string;
    displayName?: string;
  }) => Promise<AutosaveEntry>;
  update_autosave: (args: { id: string; data: number[] }) => Promise<AutosaveEntry>;
  delete_autosave: (args: { id: string }) => Promise<void>;
  read_autosave: (args: { id: string }) => Promise<Uint8Array>;
  cleanup_old_autosaves: () => Promise<number>;
}

export interface ProjectCommands {
  show_open_folder_dialog: () => Promise<string | null>;
  scan_project_folder: (args: {
    path: string;
    extensions: string[];
  }) => Promise<ProjectFileEntry[]>;
  is_directory: (args: { path: string }) => Promise<boolean>;
  reveal_in_file_manager: (args: { path: string }) => Promise<void>;
}

export interface FileOperationCommands {
  rename_path: (args: { oldPath: string; newPath: string }) => Promise<string>;
  delete_path: (args: { path: string; moveToTrash?: boolean }) => Promise<void>;
  copy_file: (args: { source: string; dest?: string }) => Promise<string>;
  import_files: (args: { sourcePaths: string[]; targetDirectory: string }) => Promise<string[]>;
  create_empty_spreadsheet: (args: { path: string }) => Promise<void>;
  generate_unique_filename: (args: {
    directory: string;
    baseName: string;
    extension: string;
  }) => Promise<string>;
  create_folder: (args: { path: string }) => Promise<void>;
  generate_unique_folder_name: (args: { directory: string; baseName: string }) => Promise<string>;
}

export interface RecentProjectsCommands {
  get_recent_projects: () => Promise<RecentProject[]>;
  add_recent_project: (args: { project: RecentProject }) => Promise<void>;
  clear_recent_projects: () => Promise<void>;
}

export interface XlsxCommands {
  import_xlsx: (args: ImportXlsxParams) => Promise<ImportXlsxResult>;
  export_xlsx: (args: ExportXlsxParams) => Promise<void>;
}

// =============================================================================
// File Commands (Secured - use secureInvoke)
// =============================================================================

async function read_file(args: { path: string }): Promise<Uint8Array> {
  // Verified level - requires HMAC signature + window verification
  // With tauri::ipc::Response, Tauri returns raw bytes as ArrayBuffer/Uint8Array.
  return secureInvoke<Uint8Array>('read_file', args);
}

async function write_file(args: { path: string; data: number[] }): Promise<void> {
  // Sensitive level - requires signature + window + rate limit + audit
  await secureInvoke('write_file', args);
}

// =============================================================================
// Dialog Commands (Public - use plain invoke)
// =============================================================================

async function show_open_dialog(args: { filters: FileFilter[] }): Promise<string | null> {
  // Public - UI operation, path validated on read
  return invoke<string | null>('show_open_dialog', args);
}

async function show_save_dialog(args: {
  defaultName?: string;
  filters: FileFilter[];
}): Promise<string | null> {
  // Public - UI operation, path validated on write
  // Tauri 2.0 expects camelCase for command parameters
  return invoke<string | null>('show_save_dialog', args);
}

// =============================================================================
// Recent Files Commands (Public - use plain invoke)
// =============================================================================

async function get_recent_files(): Promise<RecentFile[]> {
  return invoke<RecentFile[]>('get_recent_files');
}

async function add_recent_file(args: { file: RecentFile }): Promise<void> {
  await invoke('add_recent_file', args);
}

async function clear_recent_files(): Promise<void> {
  await invoke('clear_recent_files');
}

// =============================================================================
// Recent Projects Commands (Public - use plain invoke)
// =============================================================================

async function get_recent_projects(): Promise<RecentProject[]> {
  return invoke<RecentProject[]>('get_recent_projects');
}

async function add_recent_project(args: { project: RecentProject }): Promise<void> {
  await invoke('add_recent_project', args);
}

async function clear_recent_projects(): Promise<void> {
  await invoke('clear_recent_projects');
}

// =============================================================================
// Preferences Commands (Public - use plain invoke)
// =============================================================================

async function get_preference(args: { key: string }): Promise<string | null> {
  return invoke<string | null>('get_preference', args);
}

async function set_preference(args: { key: string; value: string }): Promise<void> {
  await invoke('set_preference', args);
}

// =============================================================================
// Window Commands (Public - use plain invoke)
// =============================================================================

async function get_window_state(): Promise<WindowState> {
  return invoke<WindowState>('get_window_state');
}

async function save_window_state(args: { state: WindowState }): Promise<void> {
  await invoke('save_window_state', args);
}

// =============================================================================
// System Commands (Public - use plain invoke)
// =============================================================================

async function get_app_data_dir(): Promise<string> {
  return invoke<string>('get_app_data_dir');
}

async function get_autosave_dir(): Promise<string> {
  return invoke<string>('get_autosave_dir');
}

// =============================================================================
// Autosave Commands (Public - use plain invoke)
// =============================================================================

async function list_autosave_files(): Promise<AutosaveEntry[]> {
  return invoke<AutosaveEntry[]>('list_autosave_files');
}

async function create_autosave(args: {
  data: number[];
  originalPath?: string;
  displayName?: string;
}): Promise<AutosaveEntry> {
  // Tauri 2.0 expects camelCase for command parameters
  return invoke<AutosaveEntry>('create_autosave', args);
}

async function update_autosave(args: { id: string; data: number[] }): Promise<AutosaveEntry> {
  return invoke<AutosaveEntry>('update_autosave', args);
}

async function delete_autosave(args: { id: string }): Promise<void> {
  await invoke('delete_autosave', args);
}

async function read_autosave(args: { id: string }): Promise<Uint8Array> {
  const bytes = await invoke<number[]>('read_autosave', args);
  return new Uint8Array(bytes);
}

async function cleanup_old_autosaves(): Promise<number> {
  return invoke<number>('cleanup_old_autosaves');
}

// =============================================================================
// Project Commands (Public - use plain invoke)
// =============================================================================

async function show_open_folder_dialog(): Promise<string | null> {
  // Public - UI operation
  return invoke<string | null>('show_open_folder_dialog');
}

async function scan_project_folder(args: {
  path: string;
  extensions: string[];
}): Promise<ProjectFileEntry[]> {
  return invoke<ProjectFileEntry[]>('scan_project_folder', args);
}

async function is_directory(args: { path: string }): Promise<boolean> {
  return invoke<boolean>('is_directory', args);
}

async function reveal_in_file_manager(args: { path: string }): Promise<void> {
  await invoke('reveal_in_file_manager', args);
}

// =============================================================================
// File Operation Commands (Secured - use secureInvoke)
// =============================================================================

async function rename_path(args: { oldPath: string; newPath: string }): Promise<string> {
  // Sensitive level - requires signature + window + rate limit + audit
  // Tauri 2.0 expects camelCase for command parameters (auto-converted from Rust snake_case)
  return secureInvoke<string>('rename_path', args);
}

async function delete_path(args: { path: string; moveToTrash?: boolean }): Promise<void> {
  // Critical level - requires signature + window + rate limit + audit + biometric
  // Tauri 2.0 expects camelCase for command parameters
  await secureInvoke('delete_path', {
    path: args.path,
    moveToTrash: args.moveToTrash ?? true, // Default to trash for safety
  });
}

async function copy_file(args: { source: string; dest?: string }): Promise<string> {
  // Verified level - requires HMAC signature + window verification
  return secureInvoke<string>('copy_file', {
    source: args.source,
    dest: args.dest ?? null,
  });
}

async function create_empty_spreadsheet(args: { path: string }): Promise<void> {
  // Sensitive level - requires signature + window + rate limit + audit
  await secureInvoke('create_empty_spreadsheet', { path: args.path });
}

async function generate_unique_filename(args: {
  directory: string;
  baseName: string;
  extension: string;
}): Promise<string> {
  // Verified level - requires HMAC signature + window verification
  // Tauri 2.0 expects camelCase for command parameters
  return secureInvoke<string>('generate_unique_filename', args);
}

async function create_folder(args: { path: string }): Promise<void> {
  // Verified level - requires HMAC signature + window verification
  await secureInvoke('create_folder', { path: args.path });
}

async function generate_unique_folder_name(args: {
  directory: string;
  baseName: string;
}): Promise<string> {
  // Verified level - requires HMAC signature + window verification
  return secureInvoke<string>('generate_unique_folder_name', args);
}

async function import_files(args: {
  sourcePaths: string[];
  targetDirectory: string;
}): Promise<string[]> {
  // Sensitive level - requires signature + window + rate limit + audit
  return secureInvoke<string[]>('import_files', args);
}

// =============================================================================
// XLSX Operations (Secured - use secureInvoke)
// =============================================================================

export async function import_xlsx(args: ImportXlsxParams): Promise<ImportXlsxResult> {
  // Sensitive level - requires signature + window + rate limit + audit
  return secureInvoke<ImportXlsxResult, ImportXlsxParams>('import_xlsx', args);
}

export async function export_xlsx(args: ExportXlsxParams): Promise<void> {
  // Sensitive level - requires signature + window + rate limit + audit
  await secureInvoke<void, ExportXlsxParams>('export_xlsx', args);
}

// =============================================================================
// Export IPC Client
// =============================================================================

/**
 * Production IPC client that calls real Tauri commands.
 * Import this in production code.
 *
 * Commands with Rust security middleware use secureInvoke for HMAC signing:
 * - read_file, write_file (file I/O)
 * - rename_path, delete_path, copy_file (file operations)
 * - create_empty_spreadsheet, create_folder (creation)
 * - generate_unique_filename, generate_unique_folder_name (utilities)
 * - import_files (batch operations)
 * - import_xlsx, export_xlsx (XLSX operations)
 *
 * Public commands use plain invoke:
 * - show_open_dialog, show_save_dialog, show_open_folder_dialog (UI dialogs)
 * - get/add/clear_recent_files, get/add/clear_recent_projects (history)
 * - get/set_preference (settings)
 * - get/save_window_state (window)
 * - get_app_data_dir, get_autosave_dir (paths)
 * - list/create/update/delete/read_autosave, cleanup_old_autosaves (autosave)
 * - scan_project_folder, is_directory, reveal_in_file_manager (project)
 */
export const ipc: IpcClient &
  ProjectCommands &
  FileOperationCommands &
  RecentProjectsCommands &
  XlsxCommands = {
  // File operations (secured)
  read_file,
  write_file,
  // Dialog operations (public)
  show_open_dialog,
  show_save_dialog,

  // Recent files (public)
  get_recent_files,
  add_recent_file,
  clear_recent_files,

  // Recent projects (public)
  get_recent_projects,
  add_recent_project,
  clear_recent_projects,

  // Preferences (public)
  get_preference,
  set_preference,

  // Window (public)
  get_window_state,
  save_window_state,

  // System (public)
  get_app_data_dir,
  get_autosave_dir,

  // Autosave (public)
  list_autosave_files,
  create_autosave,
  update_autosave,
  delete_autosave,
  read_autosave,
  cleanup_old_autosaves,

  // Project (public)
  show_open_folder_dialog,
  scan_project_folder,
  is_directory,
  reveal_in_file_manager,

  // File Operations (secured)
  rename_path,
  delete_path,
  copy_file,
  import_files,
  create_empty_spreadsheet,
  generate_unique_filename,
  create_folder,
  generate_unique_folder_name,

  // XLSX Operations (secured)
  import_xlsx,
  export_xlsx,
};

export default ipc;
