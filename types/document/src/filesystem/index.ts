/**
 * Filesystem abstraction contracts for Spreadsheet OS.
 *
 * TYPES ONLY — this module contains only type definitions for the filesystem system.
 * All runtime code (path utilities, permission functions, error classes, sandbox
 * helpers) lives in @mog-sdk/kernel/services/filesystem/.
 */

// Core filesystem interface and types
export type {
  DeleteOptions,
  FileEntry,
  FileStat,
  IFileSystem,
  MkdirOptions,
  RmdirOptions,
  Unsubscribe,
  WatchCallback,
  WatchCreateEvent,
  WatchDeleteEvent,
  WatchEvent,
  WatchModifyEvent,
  WatchRenameEvent,
} from './types';

// Path branded types (type-only)
export type { AnyPath, DirPath, FilePath } from './paths';

// Permission types (type-only)
export type { AccessLevel, AppId, FilePermission, SandboxConfig } from './permissions';
