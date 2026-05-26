/**
 * File Type Registry
 *
 * Central registry for document type handlers.
 * Maps file extensions to their corresponding handlers.
 *
 * Usage:
 * ```typescript
 * // At app startup, handlers register themselves:
 * fileTypeRegistry.register(spreadsheetHandler);
 * fileTypeRegistry.register(codeHandler);
 *
 * // To get a handler for a file:
 * const handler = fileTypeRegistry.getHandler('.xlsx');
 * if (handler) {
 * const viewer = await handler.createViewer(container);
 * const proxy = await handler.loadFromBytes(viewer, bytes, fileId);
 * }
 * ```
 *
 * STATUS: Foundation
 *
 */

// TODO: Import from shared types once document types are migrated
// import type { DocumentType, FileTypeHandler } from '../../types/document';

// Temporary inline types until document types are migrated
export type DocumentType =
  | 'spreadsheet'
  | 'code'
  | 'pdf'
  | 'markdown'
  | 'word'
  | 'image'
  | 'unknown';

export interface FileTypeHandler {
  /** Document type this handler manages */
  documentType: DocumentType;
  /** File extensions this handler supports (without dots) */
  extensions: string[];
  /** Display name for the document type */
  displayName: string;
  /** Create a viewer container for this document type */
  createViewer?: (container: HTMLElement) => Promise<unknown>;
  /** Load a file from bytes into the viewer */
  loadFromBytes?: (viewer: unknown, bytes: Uint8Array, fileId: string) => Promise<unknown>;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Default fallback extensions used when the registry is not yet populated.
 * These are the core spreadsheet extensions that are always supported.
 */
export const DEFAULT_FALLBACK_EXTENSIONS = ['xlsx', 'xls', 'csv'] as const;

// =============================================================================
// FILE TYPE REGISTRY
// =============================================================================

/**
 * Registry for file type handlers.
 * Singleton pattern - use the exported `fileTypeRegistry` instance.
 */
export class FileTypeRegistry {
  /** Map of lowercase extension (without dot) → handler */
  private handlers = new Map<string, FileTypeHandler>();

  /** Ordered list of registered handlers (for iteration) */
  private handlerList: FileTypeHandler[] = [];

  /**
   * Register a file type handler.
   * The handler's extensions are automatically normalized (lowercase, no dot).
   *
   * @param handler - The handler to register
   * @throws Error if any extension is already registered
   */
  register(handler: FileTypeHandler): void {
    for (const ext of handler.extensions) {
      const normalized = this.normalizeExtension(ext);
      if (this.handlers.has(normalized)) {
        const existing = this.handlers.get(normalized)!;
        throw new Error(
          `Extension ".${normalized}" is already registered by ${existing.documentType} handler`,
        );
      }
      this.handlers.set(normalized, handler);
    }
    this.handlerList.push(handler);
  }

  /**
   * Get the handler for a file extension or path.
   *
   * @param extensionOrPath - File extension (with or without dot) or full file path
   * @returns The handler, or undefined if no handler is registered
   */
  getHandler(extensionOrPath: string): FileTypeHandler | undefined {
    const ext = this.extractExtension(extensionOrPath);
    if (!ext) return undefined;
    return this.handlers.get(ext);
  }

  /**
   * Get the document type for a file extension or path.
   *
   * @param extensionOrPath - File extension or full file path
   * @returns The document type, or 'unknown' if not registered
   */
  getDocumentType(extensionOrPath: string): DocumentType {
    const handler = this.getHandler(extensionOrPath);
    return handler?.documentType ?? 'unknown';
  }

  /**
   * Check if a file extension is supported.
   *
   * @param extensionOrPath - File extension or full file path
   * @returns true if a handler is registered for this extension
   */
  isSupported(extensionOrPath: string): boolean {
    return this.getHandler(extensionOrPath) !== undefined;
  }

  /**
   * Get all supported file extensions.
   *
   * @returns Array of extensions (lowercase, without dots)
   */
  getSupportedExtensions(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Get all supported extensions with their document types.
   *
   * @returns Array of { extension, documentType } objects
   */
  getExtensionMap(): Array<{ extension: string; documentType: DocumentType }> {
    const result: Array<{ extension: string; documentType: DocumentType }> = [];
    for (const [extension, handler] of this.handlers) {
      result.push({ extension, documentType: handler.documentType });
    }
    return result;
  }

  /**
   * Get all extensions for a specific document type.
   *
   * @param type - The document type to filter by
   * @returns Array of extensions (lowercase, without dots)
   */
  getExtensionsForType(type: DocumentType): string[] {
    const result: string[] = [];
    for (const [extension, handler] of this.handlers) {
      if (handler.documentType === type) {
        result.push(extension);
      }
    }
    return result;
  }

  /**
   * Get all registered handlers.
   *
   * @returns Array of handlers in registration order
   */
  getHandlers(): FileTypeHandler[] {
    return [...this.handlerList];
  }

  /**
   * Clear all registered handlers.
   * Primarily for testing.
   */
  clear(): void {
    this.handlers.clear();
    this.handlerList = [];
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Normalize an extension to lowercase without leading dot.
   */
  private normalizeExtension(ext: string): string {
    return ext.toLowerCase().replace(/^\./, '');
  }

  /**
   * Extract the extension from a path or extension string.
   * Returns lowercase extension without dot, or undefined if none found.
   *
   * Examples:
   * - 'ts' → 'ts'
   * - '.ts' → 'ts'
   * - 'file.ts' → 'ts'
   * - 'path/to/file.ts' → 'ts'
   * - 'file' → undefined
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
 * Global file type registry instance.
 * All handlers should register with this instance.
 */
export const fileTypeRegistry = new FileTypeRegistry();

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get a file filter for native file dialogs.
 * Groups extensions by document type.
 *
 * @returns Array of file filters suitable for Tauri dialog
 */
export function getFileFilters(): Array<{ name: string; extensions: string[] }> {
  const typeGroups = new Map<DocumentType, string[]>();

  for (const [ext, handler] of fileTypeRegistry['handlers']) {
    const existing = typeGroups.get(handler.documentType) ?? [];
    existing.push(ext);
    typeGroups.set(handler.documentType, existing);
  }

  const filters: Array<{ name: string; extensions: string[] }> = [];

  // Add "All Supported Files" filter
  const allExtensions = fileTypeRegistry.getSupportedExtensions();
  if (allExtensions.length > 0) {
    filters.push({
      name: 'All Supported Files',
      extensions: allExtensions,
    });
  }

  // Add per-type filters
  const typeNames: Record<DocumentType, string> = {
    spreadsheet: 'Spreadsheets',
    code: 'Code Files',
    pdf: 'PDF Documents',
    markdown: 'Markdown Files',
    word: 'Word Documents',
    image: 'Images',
    unknown: 'Other Files',
  };

  for (const [type, extensions] of typeGroups) {
    if (type !== 'unknown' && extensions.length > 0) {
      filters.push({
        name: typeNames[type],
        extensions,
      });
    }
  }

  return filters;
}
