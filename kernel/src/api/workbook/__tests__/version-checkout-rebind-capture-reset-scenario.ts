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
}
