/**
 * Project Service Types
 *
 * Core types for project folder management.
 * Adapted from client/desktop/ with cleaner organization.
 */

/** File or folder in the project tree */
export interface ProjectFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: ProjectFileEntry[];
  isExpanded?: boolean;
}

/** Metadata for an open file */
export interface FileMetadata {
  id: string;
  filePath: string | null;
  displayName: string;
  isModified: boolean;
  lastSaved: Date | null;
  documentType: DocumentType;
}

/** Supported document types */
export type DocumentType = 'spreadsheet' | 'code' | 'pdf' | 'markdown' | 'image' | 'unknown';

/** Recent project entry */
export interface RecentProject {
  path: string;
  name: string;
  lastOpened: string; // ISO 8601
}
