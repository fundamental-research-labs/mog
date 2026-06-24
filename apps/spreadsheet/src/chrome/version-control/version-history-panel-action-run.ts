export const VERSION_COMMIT_DIRTY_REFRESH_EVENTS = [
  'workbook:version-dirty-status-changed',
  'workbook:version-checkout-materialized',
] as const;

export type VersionPanelActionKind =
  | 'branch'
  | 'checkout'
  | 'commit'
  | 'merge-preview'
  | 'merge-apply'
  | 'merge-restore'
  | 'remote-promote'
  | 'rollback';

export type VersionPanelActionRun = {
  readonly id: number;
  readonly kind: VersionPanelActionKind;
};
