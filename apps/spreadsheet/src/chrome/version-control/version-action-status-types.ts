import type { VersionDiagnostic } from '@mog-sdk/contracts/api';

export type VersionPanelDiagnostic = {
  readonly code: string;
  readonly severity: VersionDiagnostic['severity'];
  readonly message: string;
};

export type VersionActionState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly label: string }
  | { readonly status: 'success'; readonly message: string }
  | { readonly status: 'error'; readonly diagnostic: VersionPanelDiagnostic };

export type VersionRemotePromotionStatus = {
  readonly state: 'ready' | 'pending' | 'running' | 'unavailable';
  readonly label: string;
  readonly detail?: string;
};
