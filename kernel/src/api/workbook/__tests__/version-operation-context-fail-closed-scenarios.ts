import type { MutationResult } from '../../../bridges/compute/compute-types.gen';

import {
  clearCapture,
  createBridgeFixture,
  mutationResult,
} from './version-operation-context-test-utils';

export function registerVersionOperationContextFailClosedScenarios(): void {
  describe('VersionOperationContext fail-closed admission for public worksheet/sheet writes', () => {
    it.each([
      ['compute_batch_set_cells_by_position'],
      ['compute_create_sheet_with_default_col_width'],
      ['compute_rename_compute_sheet'],
      ['compute_delete_sheet'],
    ])('rejects %s before transport when context is missing', async (operation) => {
      const { bridge, capture, diagnostics, transport } = createBridgeFixture();
      clearCapture(capture);

      await expect(
        bridge.core.mutatePublic(operation, () =>
          Promise.resolve([new Uint8Array(), mutationResult()] as [Uint8Array, MutationResult]),
        ),
      ).rejects.toThrow(
        `VersionOperationContext is required for capture-required public mutation '${operation}'.`,
      );

      expect(capture.recordPreMutation).not.toHaveBeenCalled();
      expect(capture.recordMutationResult).not.toHaveBeenCalled();
      expect(transport.call).not.toHaveBeenCalled();
      expect(diagnostics).toEqual([
        expect.objectContaining({
          code: 'versioning.admission.missing-context',
          severity: 'error',
          command: operation,
        }),
      ]);
    });
  });
}
