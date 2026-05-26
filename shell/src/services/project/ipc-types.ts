/**
 * Project IPC Contracts
 *
 * TypeScript interfaces for Tauri commands.
 * Matches Rust commands in src-tauri/src/commands/
 *
 * Note: Method names use snake_case to match Rust command naming conventions.
 */

import type { ProjectFileEntry, RecentProject } from './types';

export interface ProjectIpc {
  // File I/O (from file.rs)
  read_file: (args: { path: string }) => Promise<Uint8Array>;
  write_file: (args: { path: string; data: number[] }) => Promise<void>;

  // Project scanning (from project.rs)
  scan_project_folder: (args: {
    path: string;
    extensions: string[];
  }) => Promise<ProjectFileEntry[]>;
  show_open_folder_dialog: () => Promise<string | null>;
  is_directory: (args: { path: string }) => Promise<boolean>;
  reveal_in_file_manager: (args: { path: string }) => Promise<void>;

  // File operations (from file_ops.rs + project.rs)
  rename_path: (args: { oldPath: string; newPath: string }) => Promise<string>;
  delete_path: (args: { path: string; moveToTrash?: boolean }) => Promise<void>;
  copy_file: (args: { source: string; dest?: string }) => Promise<string>;
  create_empty_spreadsheet: (args: { path: string }) => Promise<void>;
  create_folder: (args: { path: string }) => Promise<void>;
  generate_unique_filename: (args: {
    directory: string;
    baseName: string;
    extension: string;
  }) => Promise<string>;
  generate_unique_folder_name: (args: { directory: string; baseName: string }) => Promise<string>;
  import_files: (args: { sourcePaths: string[]; targetDirectory: string }) => Promise<string[]>;

  // Recent projects (from recent_files.rs - adapted)
  get_recent_projects: () => Promise<RecentProject[]>;
  add_recent_project: (args: { project: RecentProject }) => Promise<void>;
  clear_recent_projects: () => Promise<void>;
}
