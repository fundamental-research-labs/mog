/**
 * Type-safe path types for Spreadsheet OS filesystem.
 *
 * Uses branded types to distinguish between file paths and directory paths
 * at compile time, preventing common path-related bugs.
 *
 * TYPES ONLY — all runtime path utilities live in @mog-sdk/kernel/services/filesystem/paths.
 */

// ============================================================
// Branded Types
// ============================================================

/**
 * Brand symbol for file paths.
 * @internal
 */
declare const FilePathBrand: unique symbol;

/**
 * Brand symbol for directory paths.
 * @internal
 */
declare const DirPathBrand: unique symbol;

/**
 * A branded string type representing a file path.
 * Use `filePath()` from kernel to create instances.
 */
export type FilePath = string & { readonly [FilePathBrand]: never };

/**
 * A branded string type representing a directory path.
 * Use `dirPath()` from kernel to create instances.
 */
export type DirPath = string & { readonly [DirPathBrand]: never };

/**
 * Union type for any path (file or directory).
 */
export type AnyPath = FilePath | DirPath;
