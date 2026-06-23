import type {
  createInMemoryVersionStoreProvider,
  VersionGraphInitializeResult,
} from '../../../document/version-store/provider';

export type TestVersionStoreProvider = ReturnType<typeof createInMemoryVersionStoreProvider>;
export type InitializedVersionGraph = Extract<VersionGraphInitializeResult, { status: 'success' }>;

export type ProviderHeadProjection = {
  readonly id: string;
  readonly refName: string;
  readonly resolvedFrom: string;
  readonly refRevision?: unknown;
};
