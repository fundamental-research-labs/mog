/**
 * WorksheetProtectionImpl — Implementation of the WorksheetProtection sub-API.
 *
 * Calls computeBridge directly for all protection operations.
 * All mutations throw on failure.
 */

import type {
  AllowEditRange,
  ProtectionConfig,
  ProtectionOperation,
  ProtectionOptions,
  SheetId,
  WorksheetAllowEditRanges,
  WorksheetProtection,
} from '@mog-sdk/contracts/api';
import { KernelError } from '../../errors';
import { hashExcelPassword } from '@mog/spreadsheet-utils/protection';

import type { DocumentContext } from '../../context';
import { normalizeProtectionOptions } from './protection-options';

const VALID_PROTECTION_OPS: ReadonlySet<string> = new Set<ProtectionOperation>([
  'insertRows',
  'insertColumns',
  'deleteRows',
  'deleteColumns',
  'formatCells',
  'formatRows',
  'formatColumns',
  'sort',
  'filter',
  'editObject',
]);

export class WorksheetProtectionImpl implements WorksheetProtection {
  /** Stored config while protection is paused */
  private _pausedConfig: { passwordHash: string | null } | null = null;
  private _isPaused = false;
  private _allowEditRanges?: WorksheetAllowEditRangesImpl;

  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {}

  private _ensureWritable(op: string): void {
    this.ctx.writeGate.assertWritable(op);
  }

  async isProtected(): Promise<boolean> {
    return this.ctx.computeBridge.isSheetProtected(this.sheetId);
  }

  async protect(password?: string): Promise<void> {
    this._ensureWritable('protection.protect');
    const passwordHash = password ? hashExcelPassword(password) : null;
    await this.ctx.computeBridge.protectSheet(this.sheetId, passwordHash);
  }

  async protectWithOptions(password?: string, options?: ProtectionOptions): Promise<void> {
    this._ensureWritable('protection.protectWithOptions');
    const passwordHash = password ? hashExcelPassword(password) : null;
    await this.ctx.computeBridge.protectSheetWithOptions(
      this.sheetId,
      passwordHash,
      normalizeProtectionOptions(options),
    );
  }

  async unprotect(password?: string): Promise<boolean> {
    this._ensureWritable('protection.unprotect');
    const passwordHash = password ? hashExcelPassword(password) : null;
    try {
      await this.ctx.computeBridge.unprotectSheet(this.sheetId, passwordHash);
      // Clear pause state if sheet is explicitly unprotected
      this._isPaused = false;
      this._pausedConfig = null;

      return true;
    } catch {
      // Password mismatch — sheet remains protected
      return false;
    }
  }

  async canEditCell(row: number, col: number): Promise<boolean> {
    return this.ctx.computeBridge.canEditCell(this.sheetId, row, col);
  }

  canEditCellFast(_row: number, _col: number): true | 'unknown' {
    return this.ctx.mirror.getSheetSettings(this.sheetId).isProtected ? 'unknown' : true;
  }

  async canDoStructureOp(operation: ProtectionOperation): Promise<boolean> {
    if (!VALID_PROTECTION_OPS.has(operation)) {
      throw new Error(
        `Invalid protection operation "${operation}". Must be one of: ${[...VALID_PROTECTION_OPS].join(', ')}`,
      );
    }

    return this.ctx.computeBridge.canDoStructureOp(this.sheetId, operation);
  }

  async canSort(): Promise<boolean> {
    return this.canDoStructureOp('sort');
  }

  async getConfig(): Promise<ProtectionConfig> {
    // getSheetProtectionOptions returns null when sheet is NOT protected,
    // and SheetProtectionOptions when it IS protected.
    const raw = await this.ctx.computeBridge.getSheetProtectionOptions(this.sheetId);
    const isProtected = raw !== null;
    if (!raw) {
      return { isProtected: false };
    }
    return {
      isProtected,
      allowSelectLockedCells: raw.selectLockedCells,
      allowSelectUnlockedCells: raw.selectUnlockedCells,
      allowFormatCells: raw.formatCells,
      allowFormatColumns: raw.formatColumns,
      allowFormatRows: raw.formatRows,
      allowInsertColumns: raw.insertColumns,
      allowInsertRows: raw.insertRows,
      allowInsertHyperlinks: raw.insertHyperlinks,
      allowDeleteColumns: raw.deleteColumns,
      allowDeleteRows: raw.deleteRows,
      allowSort: raw.sort,
      allowAutoFilter: raw.useAutoFilter,
      allowPivotTables: raw.usePivotTableReports,
      allowEditObjects: raw.editObjects,
      allowEditScenarios: raw.editScenarios,
    };
  }

  async getSelectionMode(): Promise<'normal' | 'unlockedOnly' | 'none'> {
    // Selection mode lives in protectionDetails regardless of protection status.
    const settings = await this.ctx.computeBridge.getSheetSettings(this.sheetId);
    const opts = settings.protectionOptions;

    const selectLocked = opts?.selectLockedCells ?? true;
    const selectUnlocked = opts?.selectUnlockedCells ?? true;

    if (selectLocked && selectUnlocked) return 'normal';
    if (!selectLocked && selectUnlocked) return 'unlockedOnly';
    return 'none';
  }

  async setSelectionMode(mode: 'normal' | 'unlockedOnly' | 'none'): Promise<void> {
    const selectLocked = mode === 'normal';
    const selectUnlocked = mode !== 'none';

    await this.ctx.computeBridge.setSheetSettings(this.sheetId, {
      selectLockedCells: selectLocked,
      selectUnlockedCells: selectUnlocked,
    });
  }

  // ---------------------------------------------------------------------------
  // Pause / Resume
  // ---------------------------------------------------------------------------

  async pauseProtection(password?: string): Promise<void> {
    if (this._isPaused) {
      throw new KernelError('OPERATION_FAILED', 'Protection is already paused');
    }

    const isProtected = await this.isProtected();
    if (!isProtected) {
      throw new KernelError('OPERATION_FAILED', 'Sheet is not protected');
    }

    // Verify password if sheet is password-protected
    const settings = await this.ctx.computeBridge.getSheetSettings(this.sheetId);
    const storedHash = settings.protectionPasswordHash ?? null;

    if (storedHash) {
      const inputHash = password ? hashExcelPassword(password) : null;
      if (inputHash !== storedHash) {
        throw new KernelError('API_PROTECTED_SHEET', 'Incorrect protection password');
      }
    }

    // Store the password hash so we can re-protect with it
    this._pausedConfig = { passwordHash: storedHash };

    // Actually remove protection
    await this.ctx.computeBridge.unprotectSheet(this.sheetId, storedHash);
    this._isPaused = true;
  }

  async resumeProtection(): Promise<void> {
    if (!this._isPaused || !this._pausedConfig) {
      throw new KernelError('OPERATION_FAILED', 'Protection is not currently paused');
    }

    // Re-apply protection with the stored password hash
    await this.ctx.computeBridge.protectSheet(this.sheetId, this._pausedConfig.passwordHash);

    this._isPaused = false;
    this._pausedConfig = null;
  }

  get canPauseProtection(): boolean {
    // Synchronous check — uses cached pause state.
    // The sheet's actual protection status is async, but the OfficeJS parity
    // spec defines this as a sync property. We return false when paused since
    // you can't pause something that's already paused.
    return !this._isPaused;
  }

  get isPaused(): boolean {
    return this._isPaused;
  }

  // ---------------------------------------------------------------------------
  // Password / Options management
  // ---------------------------------------------------------------------------

  async checkPassword(password?: string): Promise<boolean> {
    const settings = await this.ctx.computeBridge.getSheetSettings(this.sheetId);
    const storedHash = settings.protectionPasswordHash ?? null;

    // If no password is stored, an empty/undefined password matches
    if (!storedHash) {
      return !password;
    }

    const inputHash = password ? hashExcelPassword(password) : null;
    return inputHash === storedHash;
  }

  async setPassword(password?: string): Promise<void> {
    const isProtected = await this.isProtected();
    if (!isProtected) {
      throw new KernelError('OPERATION_FAILED', 'Sheet is not protected');
    }

    // Get current hash so we can unprotect
    const settings = await this.ctx.computeBridge.getSheetSettings(this.sheetId);
    const currentHash = settings.protectionPasswordHash ?? null;

    // Unprotect with current hash, then re-protect with new hash
    await this.ctx.computeBridge.unprotectSheet(this.sheetId, currentHash);
    const newHash = password ? hashExcelPassword(password) : null;
    await this.ctx.computeBridge.protectSheet(this.sheetId, newHash);
  }

  async updateOptions(options: Partial<ProtectionOptions>): Promise<void> {
    const isProtected = await this.isProtected();
    if (!isProtected) {
      throw new KernelError('OPERATION_FAILED', 'Sheet is not protected');
    }

    const settings = await this.ctx.computeBridge.getSheetSettings(this.sheetId);
    const current = normalizeProtectionOptions(settings.protectionOptions);
    const next = normalizeProtectionOptions({ ...current, ...options });
    await this.ctx.computeBridge.setSheetProtectionOptions(this.sheetId, next);
  }

  // ---------------------------------------------------------------------------
  // Allow-edit ranges
  // ---------------------------------------------------------------------------

  get allowEditRanges(): WorksheetAllowEditRanges {
    return (this._allowEditRanges ??= new WorksheetAllowEditRangesImpl(this.ctx, this.sheetId));
  }
}

// =============================================================================
// WorksheetAllowEditRangesImpl
// =============================================================================

/**
 * In-memory collection of allow-edit ranges for a sheet.
 *
 * These ranges define areas that remain editable even when the sheet is protected.
 * Stored in memory on the TS side; a future iteration can persist them via the
 * compute bridge / sheet settings.
 */
class WorksheetAllowEditRangesImpl implements WorksheetAllowEditRanges {
  private readonly ranges: Map<string, AllowEditRange> = new Map();

  constructor(
    private readonly _ctx: DocumentContext,
    private readonly _sheetId: SheetId,
  ) {}

  async add(title: string, address: string): Promise<void> {
    if (!title) {
      throw new KernelError('API_INVALID_ARGUMENT', 'Allow-edit range title must not be empty');
    }
    if (!address) {
      throw new KernelError('API_INVALID_ARGUMENT', 'Allow-edit range address must not be empty');
    }
    if (this.ranges.has(title)) {
      throw new KernelError(
        'OPERATION_FAILED',
        `Allow-edit range with title "${title}" already exists`,
      );
    }
    this.ranges.set(title, { title, address });
  }

  async remove(title: string): Promise<void> {
    if (!this.ranges.has(title)) {
      throw new KernelError('OPERATION_FAILED', `Allow-edit range with title "${title}" not found`);
    }
    this.ranges.delete(title);
  }

  async list(): Promise<AllowEditRange[]> {
    return [...this.ranges.values()];
  }
}
