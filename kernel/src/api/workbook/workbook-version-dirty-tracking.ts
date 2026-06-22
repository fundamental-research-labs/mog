import type {
  VersionCommitOptions,
  VersionResult,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { WorkbookVersionImpl } from './version';
import type { VersionCheckoutTransactionGuard } from './version-checkout';

export class WorkbookVersionWithDirtyTracking extends WorkbookVersionImpl {
  constructor(
    ctx: DocumentContext,
    private readonly dirtyTracking: {
      readonly checkoutTransactionGuard?: VersionCheckoutTransactionGuard;
      readonly markClean: () => void;
    },
  ) {
    super(ctx, {
      ...(dirtyTracking.checkoutTransactionGuard
        ? { checkoutTransactionGuard: dirtyTracking.checkoutTransactionGuard }
        : {}),
    });
  }

  override async commit(
    options: VersionCommitOptions = {},
  ): Promise<VersionResult<WorkbookCommitSummary>> {
    const result = await super.commit(options);
    if (result.ok) {
      this.dirtyTracking.markClean();
    }
    return result;
  }
}
