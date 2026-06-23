import { expect } from '@jest/globals';

export {
  createMockCtx,
  createWorkbook,
  plannedCheckoutResult,
} from './version-checkout-test-utils';

export const RAW_ROOM_ID = 'raw-room-id:live-collaboration-room';
export const RAW_USER_ID = 'raw-user-id:live-collaboration-user';
export const RAW_PROVIDER_ID = 'raw-provider-id:live-collaboration-provider';

export function cleanSurfaceDirtyStatus() {
  return {
    statusRevision: 'dirty-revision-clean',
    checkoutPreflightToken: 'checkout-preflight-token-clean',
    hasUncommittedLocalChanges: false,
    commitEligibleChanges: false,
    unsupportedDirtyDomains: [],
    pendingProviderWrites: false,
    pendingRecalc: false,
    checkoutSafe: true,
    unsafeReasons: [],
    source: 'VC-05' as const,
    diagnostics: [],
  };
}

export function expectNoRawCollaborationIdentifiers(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(RAW_ROOM_ID);
  expect(serialized).not.toContain(RAW_USER_ID);
  expect(serialized).not.toContain(RAW_PROVIDER_ID);
}
