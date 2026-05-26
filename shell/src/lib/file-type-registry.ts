/**
 * File Type Registry
 *
 * Maps file extensions to document types.
 * Simplified version adapted from client/desktop/ for OS shell.
 *
 * Usage:
 * ```typescript
 * import { fileTypeRegistry } from './lib';
 *
 * // Check if a file is supported
 * if (fileTypeRegistry.isSupported('/path/to/file.xlsx')) {
 *   const type = fileTypeRegistry.getDocumentType('/path/to/file.xlsx');
 *   // type === 'spreadsheet'
 * }
 *
 * // Get all supported extensions for project scanning
 * const extensions = fileTypeRegistry.getSupportedExtensions();
 * // ['xlsx', 'xls', 'csv', 'ts', 'js', ...]
 * ```
 */

import type { DocumentType } from '../services/project/types';

// =============================================================================
// EXTENSION MAPPINGS
// =============================================================================

/**
 * Map of extensions to document types.
 * Extensions are lowercase, without leading dot.
 */
const EXTENSION_MAP: Record<string, DocumentType> = {
  // Spreadsheets
  xlsx: 'spreadsheet',
  xls: 'spreadsheet',
  csv: 'spreadsheet',

  // Code files
  ts: 'code',
  tsx: 'code',
  js: 'code',
  jsx: 'code',
  mjs: 'code',
  cjs: 'code',
  json: 'code',
  py: 'code',
  rb: 'code',
  go: 'code',
  rs: 'code',
  java: 'code',
  c: 'code',
  cpp: 'code',
  h: 'code',
  hpp: 'code',
  cs: 'code',
  swift: 'code',
  kt: 'code',
  scala: 'code',
  php: 'code',
  sql: 'code',
  sh: 'code',
  bash: 'code',
  zsh: 'code',
  yaml: 'code',
  yml: 'code',
  toml: 'code',
  xml: 'code',
  html: 'code',
  css: 'code',
  scss: 'code',
  sass: 'code',
  less: 'code',
  vue: 'code',
  svelte: 'code',

  // Markdown
  md: 'markdown',
  mdx: 'markdown',

  // PDF
  pdf: 'pdf',

  // Images
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  bmp: 'image',
  ico: 'image',
};

// =============================================================================
// FILE TYPE REGISTRY CLASS
// =============================================================================

/**
 * Registry for file type mappings.
 * Provides methods to check support and get document types.
 */
export class FileTypeRegistry {
  private extensions: Map<string, DocumentType>;

  constructor(extensionMap: Record<string, DocumentType> = EXTENSION_MAP) {
    this.extensions = new Map(Object.entries(extensionMap));
  }

  /**
   * Get all supported file extensions.
   *
   * @returns Array of extensions (lowercase, without dots)
   */
  getSupportedExtensions(): string[] {
    return Array.from(this.extensions.keys());
  }

  /**
   * Check if a file extension or path is supported.
   *
   * @param extensionOrPath - File extension (with or without dot) or full file path
   * @returns true if the extension is supported
   */
  isSupported(extensionOrPath: string): boolean {
    const ext = this.extractExtension(extensionOrPath);
    return ext !== undefined && this.extensions.has(ext);
  }

  /**
   * Get the document type for a file extension or path.
   *
   * @param extensionOrPath - File extension or full file path
   * @returns The document type, or 'unknown' if not supported
   */
  getDocumentType(extensionOrPath: string): DocumentType {
    const ext = this.extractExtension(extensionOrPath);
    if (!ext) return 'unknown';
    return this.extensions.get(ext) ?? 'unknown';
  }

  /**
   * Get all extensions for a specific document type.
   *
   * @param type - The document type to filter by
   * @returns Array of extensions (lowercase, without dots)
   */
  getExtensionsForType(type: DocumentType): string[] {
    const result: string[] = [];
    this.extensions.forEach((docType, ext) => {
      if (docType === type) {
        result.push(ext);
      }
    });
    return result;
  }

  /**
   * Register a new extension mapping.
   * Useful for extending the registry at runtime.
   *
   * @param extension - The extension (with or without dot)
   * @param type - The document type
   */
  register(extension: string, type: DocumentType): void {
    const normalized = extension.toLowerCase().replace(/^\./, '');
    this.extensions.set(normalized, type);
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Extract the extension from a path or extension string.
   * Returns lowercase extension without dot, or undefined if none found.
   *
   * Examples:
   * - 'ts' -> 'ts'
   * - '.ts' -> 'ts'
   * - 'file.ts' -> 'ts'
   * - 'path/to/file.ts' -> 'ts'
   * - 'file' -> undefined
   */
  private extractExtension(pathOrExt: string): string | undefined {
    if (!pathOrExt) return undefined;

    // Extract extension from path or filename
    const lastDot = pathOrExt.lastIndexOf('.');
    if (lastDot === -1) {
      // No dot - could be just an extension like 'ts' or a file without extension
      // If it's a short string with no path separators, treat it as an extension
      if (!pathOrExt.includes('/') && !pathOrExt.includes('\\') && pathOrExt.length <= 10) {
        return pathOrExt.toLowerCase();
      }
      return undefined;
    }

    if (lastDot === pathOrExt.length - 1) {
      // Dot at the end - invalid
      return undefined;
    }

    // Make sure the dot isn't part of the path (e.g., ".hidden/file")
    const afterDot = pathOrExt.substring(lastDot + 1);
    if (afterDot.includes('/') || afterDot.includes('\\')) {
      return undefined;
    }

    return afterDot.toLowerCase();
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

/**
 * Default file type registry instance.
 * Pre-configured with common file type mappings.
 */
export const fileTypeRegistry = new FileTypeRegistry();

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Default fallback extensions used when scanning projects.
 * These are the core spreadsheet extensions that are always supported.
 */
export const DEFAULT_SPREADSHEET_EXTENSIONS = ['xlsx', 'xls', 'csv'] as const;
