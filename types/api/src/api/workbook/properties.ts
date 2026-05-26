/**
 * WorkbookProperties -- Document properties sub-API interface.
 *
 * Provides methods to read and write document metadata (title, author,
 * keywords, etc.) and custom document properties.
 */

export interface WorkbookProperties {
  /** Get all document properties (author, title, keywords, etc.). */
  getDocumentProperties(): Promise<DocumentProperties>;
  /** Update document properties (partial merge). */
  setDocumentProperties(props: Partial<DocumentProperties>): Promise<void>;
  /** Get a custom document property by key. */
  getCustomProperty(key: string): Promise<string | undefined>;
  /** Set a custom document property. */
  setCustomProperty(key: string, value: string): Promise<void>;
  /** Remove a custom document property. */
  removeCustomProperty(key: string): Promise<void>;
  /** List all custom document properties. */
  listCustomProperties(): Promise<Array<{ key: string; value: string }>>;
}

export interface DocumentProperties {
  title?: string;
  creator?: string;
  description?: string;
  subject?: string;
  created?: string; // ISO 8601
  modified?: string; // ISO 8601
  lastModifiedBy?: string;
  category?: string;
  keywords?: string;
  company?: string;
  manager?: string;
}
