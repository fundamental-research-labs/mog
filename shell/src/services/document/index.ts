/**
 * Document Manager Service
 *
 * Manages document lifecycle at the shell level, surviving React component remounts.
 * Documents are loaded/created via this service and accessed by React components
 * through the useDocument hook.
 *
 * Key exports:
 * - Types: DocumentLoadingState, DocumentManagerState, CreateDocumentOptions
 * - Interface: DocumentManager
 * - Factory: createDocumentManager()
 *
 */

// Core types
export type {
  CreateCollaborationDocumentOptions,
  CreateDocumentOptions,
  DocumentLoadingState,
  DocumentManagerListener,
  DocumentManagerState,
  LoadDocumentOptions,
  ShellDocumentMode,
  Unsubscribe,
} from './types';
export {
  attachImportedPivotMetadata,
  extractImportedPivotMetadata,
  getImportedPivotMetadata,
} from './imported-pivot-metadata';
export type {
  ImportedPivotFieldMetadata,
  ImportedPivotMetadataSet,
  ImportedPivotRange,
  ImportedPivotTableMetadata,
} from './imported-pivot-metadata';

// Interface
export type { DocumentManager } from './document-manager';

// Factory
export { createDocumentManager } from './create-document-manager';
