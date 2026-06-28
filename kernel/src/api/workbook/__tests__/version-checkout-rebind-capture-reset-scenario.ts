import { expect, it, jest } from '@jest/globals';

import { rebindVersioningAfterCheckout } from '../version/checkout/version-checkout-rebind';
import { createDocumentContext, OPERATION_CONTEXT } from './version-checkout-rebind-test-utils';

export function registerCheckoutRebindCaptureResetScenario(): void {
  it('passes caller-supplied operation context to semantic capture reset', () => {
    const resetNormalCaptureForCheckout = jest.fn();
    const nextContext = createDocumentContext();

    rebindVersioningAfterCheckout({
      versioning: {
        semanticMutationCapture: {
          resetNormalCaptureForCheckout,
        },
      },
      nextContext,
      operationContext: OPERATION_CONTEXT,
    });

    expect(resetNormalCaptureForCheckout).toHaveBeenCalledTimes(1);
    expect(resetNormalCaptureForCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        semanticStateReader: expect.objectContaining({
          readCurrentSemanticState: expect.any(Function),
          diffSemanticStates: expect.any(Function),
        }),
        operationContext: OPERATION_CONTEXT,
      }),
    );
  });

  it('drops derived working-tree diff services so checkout gets fresh semantic readers', () => {
    const resetNormalCaptureForCheckout = jest.fn();
    const staleWorkingTreeDiffService = { diffWorkingTree: jest.fn() };
    const nextContext = createDocumentContext();

    const config = rebindVersioningAfterCheckout({
      versioning: {
        semanticMutationCapture: {
          resetNormalCaptureForCheckout,
        },
        workingTreeDiffService: staleWorkingTreeDiffService,
        versionWorkingTreeDiffService: staleWorkingTreeDiffService,
      },
      nextContext,
      operationContext: OPERATION_CONTEXT,
    }) as Record<string, unknown>;

    expect(config.workingTreeDiffService).toBeUndefined();
    expect(config.versionWorkingTreeDiffService).toBeUndefined();
    expect(config.semanticStateReader).toEqual(
      expect.objectContaining({
        readCurrentSemanticState: expect.any(Function),
        diffSemanticStates: expect.any(Function),
      }),
    );
    expect(resetNormalCaptureForCheckout).toHaveBeenCalledTimes(1);
  });
}
