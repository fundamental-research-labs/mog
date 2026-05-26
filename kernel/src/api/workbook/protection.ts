/**
 * WorkbookProtectionImpl -- Workbook structure protection sub-API implementation.
 *
 * Delegates to domain/workbook protect/unprotect functions.
 */
import type { WorkbookProtection } from '@mog-sdk/contracts/api';
import type { WorkbookProtectionOptions } from '@mog-sdk/contracts/protection';

import type { DocumentContext } from '../../context';
import * as WorkbookDomain from '../../domain/workbook/workbook';

export class WorkbookProtectionImpl implements WorkbookProtection {
  constructor(private readonly ctx: DocumentContext) {}

  async isProtected(): Promise<boolean> {
    return WorkbookDomain.isProtected(this.ctx);
  }

  async getOptions(): Promise<WorkbookProtectionOptions | null> {
    const protected_ = await WorkbookDomain.isProtected(this.ctx);
    if (!protected_) return null;
    return WorkbookDomain.getProtectionOptions(this.ctx);
  }

  async protect(password?: string, options?: Partial<WorkbookProtectionOptions>): Promise<void> {
    await WorkbookDomain.protect(this.ctx, password, options);
  }

  async unprotect(password?: string): Promise<boolean> {
    return WorkbookDomain.unprotect(this.ctx, password);
  }
}
