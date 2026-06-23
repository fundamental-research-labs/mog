import { useEffect, useState } from 'react';

import type { Workbook } from '@mog-sdk/contracts/api';

type RendererInvalidator = {
  readonly renderer: {
    invalidate(reason: string): void;
  };
};

export function useVersionCheckoutMaterializationEpoch(
  workbook: Pick<Workbook, 'on'>,
  coordinator: RendererInvalidator,
): number {
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    return workbook.on('workbook:version-checkout-materialized', () => {
      setEpoch((value) => value + 1);
      coordinator.renderer.invalidate('version-checkout');
    });
  }, [coordinator, workbook]);

  return epoch;
}
