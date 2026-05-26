/**
 * Tauri IPC Client
 *
 * Wraps Tauri invoke calls to match ProjectIpc interface.
 * Uses snake_case command names to match Rust command naming conventions.
 *
 * @example
 * ```ts
 * import { createTauriIpc } from './tauri-ipc';
 *
 * const ipc = createTauriIpc();
 * const bytes = await ipc.read_file({ path: '/path/to/file.xlsx' });
 * ```
 */

import { invoke } from '@tauri-apps/api/core';
import { secureInvoke } from '@mog/platform/tauri/secure-invoke';
import type { ProjectIpc } from './ipc-types';

/**
 * Create a Tauri IPC client that implements the ProjectIpc interface.
 *
 * All methods delegate to Tauri invoke calls with matching command names.
 * The Rust commands are defined in src-tauri/src/commands/.
 *
 * Commands requiring security (HMAC signing) use secureInvoke:
 * - read_file (Verified level)
 * - write_file (Sensitive level)
 * - rename_path (Sensitive level)
 * - delete_path (Critical level)
 * - copy_file (Verified level)
 * - create_empty_spreadsheet (Sensitive level)
 * - create_folder (Verified level)
 * - generate_unique_filename (Verified level)
 * - generate_unique_folder_name (Verified level)
 * - import_files (Sensitive level)
 *
 * Public commands use plain invoke (no security needed):
 * - scan_project_folder
 * - show_open_folder_dialog
 * - is_directory
 * - reveal_in_file_manager
 * - get_recent_projects
 * - add_recent_project
 * - clear_recent_projects
 *
 * @returns ProjectIpc implementation using Tauri invoke
 */
export function createTauriIpc(): ProjectIpc {
  return {
    // File I/O (from file.rs) - secured
    read_file: (args) => secureInvoke('read_file', args),
    write_file: (args) => secureInvoke('write_file', args),

    // Project scanning (from project.rs) - public
    scan_project_folder: (args) => invoke('scan_project_folder', args),
    show_open_folder_dialog: () => invoke('show_open_folder_dialog'),
    is_directory: (args) => invoke('is_directory', args),
    reveal_in_file_manager: (args) => invoke('reveal_in_file_manager', args),

    // File operations (from file_ops.rs + project.rs) - secured
    rename_path: (args) => secureInvoke('rename_path', args),
    delete_path: (args) => secureInvoke('delete_path', args),
    copy_file: (args) => secureInvoke('copy_file', args),
    create_empty_spreadsheet: (args) => secureInvoke('create_empty_spreadsheet', args),
    create_folder: (args) => secureInvoke('create_folder', args),
    generate_unique_filename: (args) => secureInvoke('generate_unique_filename', args),
    generate_unique_folder_name: (args) => secureInvoke('generate_unique_folder_name', args),
    import_files: (args) => secureInvoke('import_files', args),

    // Recent projects (from recent_files.rs - adapted) - public
    get_recent_projects: () => invoke('get_recent_projects'),
    add_recent_project: (args) => invoke('add_recent_project', args),
    clear_recent_projects: () => invoke('clear_recent_projects'),
  };
}
