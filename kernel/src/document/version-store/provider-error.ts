import type { VersionStoreDiagnostic } from './provider-types';

export class VersionStoreProviderError extends Error {
  readonly diagnostic: VersionStoreDiagnostic;
  readonly diagnostics: readonly VersionStoreDiagnostic[];

  constructor(diagnostic: VersionStoreDiagnostic) {
    super(diagnostic.safeMessage);
    this.name = 'VersionStoreProviderError';
    this.diagnostic = diagnostic;
    this.diagnostics = Object.freeze([diagnostic]);
  }
}
