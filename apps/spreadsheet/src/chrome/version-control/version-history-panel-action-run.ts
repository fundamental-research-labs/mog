export type VersionPanelActionKind =
  | 'branch'
  | 'checkout'
  | 'commit'
  | 'merge-apply'
  | 'merge-preview'
  | 'remote-promote'
  | 'rollback';

export type VersionPanelActionRun = {
  readonly id: number;
  readonly kind: VersionPanelActionKind;
};

export const VERSION_COMMIT_DIRTY_REFRESH_EVENTS = [
  'workbook:version-dirty-status-changed',
  'workbook:version-checkout-materialized',
] as const;

export function versionPanelActionExpectsActiveWorkbookReadback(
  action: VersionPanelActionRun,
): boolean {
  return action.kind === 'checkout';
}
