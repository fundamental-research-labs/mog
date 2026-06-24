import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

export type ValidationResult<T> =
  | { readonly ok: true; readonly input: T }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };
