import { jest } from '@jest/globals';
import { sheetId } from '@mog-sdk/contracts/core';

import type { CheckoutSnapshotApplyInput } from '../../../document/version-store/checkout-apply';
import type { SnapshotRootFreshLifecycleMaterialization } from '../../document/snapshot-root-lifecycle-hydrator';
import { materializeCheckoutFrozenPanes } from '../version/checkout/version-checkout-materializer-frozen-panes';

const FROZEN_SHEET_ID = sheetId('sheet-frozen');
const DEFAULT_SHEET_ID = sheetId('sheet-default');

describe('checkout frozen pane materialization', () => {
  it('replays Rust-authoritative frozen panes when checkout settle left the mirror at defaults', async () => {
    const setFrozenPanes = jest.fn(async () => ({}));
    const materialization = createMaterialization({
      mirrorFrozen: {
        [FROZEN_SHEET_ID]: { rows: 0, cols: 0 },
        [DEFAULT_SHEET_ID]: { rows: 0, cols: 0 },
      },
      rustFrozen: {
        [FROZEN_SHEET_ID]: { rows: 7, cols: 1 },
        [DEFAULT_SHEET_ID]: { rows: 0, cols: 0 },
      },
      setFrozenPanes,
    });

    await expect(materializeCheckoutFrozenPanes(checkoutInput(), materialization)).resolves.toEqual(
      { status: 'materialized' },
    );

    expect(setFrozenPanes).toHaveBeenCalledTimes(1);
    expect(setFrozenPanes).toHaveBeenCalledWith(FROZEN_SHEET_ID, 7, 1);
  });

  it('does not mutate panes that already match Rust state', async () => {
    const setFrozenPanes = jest.fn(async () => ({}));
    const materialization = createMaterialization({
      mirrorFrozen: {
        [FROZEN_SHEET_ID]: { rows: 7, cols: 1 },
        [DEFAULT_SHEET_ID]: { rows: 0, cols: 0 },
      },
      rustFrozen: {
        [FROZEN_SHEET_ID]: { rows: 7, cols: 1 },
        [DEFAULT_SHEET_ID]: { rows: 0, cols: 0 },
      },
      setFrozenPanes,
    });

    await expect(materializeCheckoutFrozenPanes(checkoutInput(), materialization)).resolves.toEqual(
      { status: 'materialized' },
    );

    expect(setFrozenPanes).not.toHaveBeenCalled();
  });
});

function createMaterialization(input: {
  readonly mirrorFrozen: Record<string, { readonly rows: number; readonly cols: number }>;
  readonly rustFrozen: Record<string, { readonly rows: number; readonly cols: number }>;
  readonly setFrozenPanes: jest.Mock;
}): SnapshotRootFreshLifecycleMaterialization {
  return {
    context: {
      computeBridge: {
        getAllSheetIds: jest.fn(async () => [FROZEN_SHEET_ID, DEFAULT_SHEET_ID]),
        getFrozenPanesQuery: jest.fn(async (id: string) => input.rustFrozen[id]),
        setFrozenPanes: input.setFrozenPanes,
      },
      mirror: {
        getFrozenPanes: jest.fn((id: string) => input.mirrorFrozen[id] ?? { rows: 0, cols: 0 }),
      },
    },
  } as unknown as SnapshotRootFreshLifecycleMaterialization;
}

function checkoutInput(): CheckoutSnapshotApplyInput {
  return {
    commitId: `commit:sha256:${'7'.repeat(64)}`,
  } as CheckoutSnapshotApplyInput;
}
