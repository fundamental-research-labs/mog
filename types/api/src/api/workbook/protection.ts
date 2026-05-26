/**
 * WorkbookProtection -- Workbook structure protection sub-API interface.
 *
 * Provides methods to protect and unprotect the workbook structure
 * (prevent sheet add/delete/move/rename/hide/unhide).
 */
import type { WorkbookProtectionOptions } from '@mog/types-core/protection';

export interface WorkbookProtection {
  /** Check if the workbook structure is currently protected. */
  isProtected(): Promise<boolean>;

  /** Get the current protection options, or null if the workbook is not protected. */
  getOptions(): Promise<WorkbookProtectionOptions | null>;

  /** Protect workbook structure with optional password and options. */
  protect(password?: string, options?: Partial<WorkbookProtectionOptions>): Promise<void>;

  /** Unprotect the workbook. Returns true if successful (password matches). */
  unprotect(password?: string): Promise<boolean>;
}
