import type { VersionAccessContext } from '../provider';
import type { VersionDocumentScope } from '../registry';

export const INDEXEDDB_VERSION_STORE_PROVIDER_KIND = 'indexeddb' as const;

export type IndexedDbVersionStoreProviderOptions = {
  readonly documentScope: VersionDocumentScope;
  readonly accessContext?: VersionAccessContext;
  readonly readOnly?: boolean;
};
