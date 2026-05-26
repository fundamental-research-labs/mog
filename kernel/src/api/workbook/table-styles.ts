/**
 * WorkbookTableStylesImpl -- Table style management sub-API implementation.
 *
 * Delegates table style operations to ComputeBridge.
 */
import type { TableStyleConfig, TableStyleInfo } from '@mog-sdk/contracts/api';
import type { TableStyleInfoWithReadOnly, WorkbookTableStyles } from '@mog-sdk/contracts/api';
import type { StripePattern, TableElementStyle } from '../../bridges/compute/compute-types.gen';
import { KernelError } from '../../errors';

import { extractMutationData } from '../../bridges/compute/compute-core';
import type { DocumentContext } from '../../context';
import { getDefaultTableStyleId, setDefaultTableStyleId } from '../../domain/workbook/workbook';
import { duplicateCustomTableStyle } from '../../domain/tables/custom-styles';

const EMPTY_ELEMENT_STYLE: TableElementStyle = {};
const DEFAULT_STRIPE_PATTERN: StripePattern = { stripeSize: 1 };

/**
 * Convert a loose TableStyleConfig (public API bag type) into a fully-typed
 * TableStyleInfo (CustomTableStyleConfig) expected by the compute bridge.
 *
 * Extracts only the known fields and applies sensible defaults for any that
 * are missing, instead of blindly double-casting.
 */
function toTableStyleInfo(name: string, config: TableStyleConfig): TableStyleInfo {
  const {
    id,
    createdAt,
    updatedAt,
    headerRow,
    totalRow,
    firstColumn,
    lastColumn,
    rowStripes,
    columnStripes,
    wholeTable,
  } = config as Record<string, unknown>;

  const asElementStyle = (v: unknown): TableElementStyle =>
    (v != null && typeof v === 'object' ? v : EMPTY_ELEMENT_STYLE) as TableElementStyle;

  const asStripePattern = (v: unknown): StripePattern =>
    (v != null && typeof v === 'object' && 'stripeSize' in (v as object)
      ? v
      : DEFAULT_STRIPE_PATTERN) as StripePattern;

  const now = Date.now();
  return {
    id: typeof id === 'string' ? id : '',
    name,
    createdAt: typeof createdAt === 'number' ? createdAt : now,
    updatedAt: typeof updatedAt === 'number' ? updatedAt : now,
    headerRow: asElementStyle(headerRow),
    totalRow: asElementStyle(totalRow),
    firstColumn: asElementStyle(firstColumn),
    lastColumn: asElementStyle(lastColumn),
    rowStripes: asStripePattern(rowStripes),
    columnStripes: asStripePattern(columnStripes),
    wholeTable: asElementStyle(wholeTable),
  };
}

export class WorkbookTableStylesImpl implements WorkbookTableStyles {
  constructor(private readonly ctx: DocumentContext) {}

  async list(): Promise<TableStyleInfoWithReadOnly[]> {
    // Custom styles from compute bridge — these are mutable (not read-only)
    const customStyles = await this.ctx.computeBridge.getAllCustomTableStyles();
    return customStyles.map((s) => ({ ...s, readOnly: false }));
  }

  async add(name: string, style: TableStyleConfig): Promise<string> {
    const styleInfo = toTableStyleInfo(name, style);
    const result = await this.ctx.computeBridge.createCustomTableStyle(styleInfo);
    const styleId = extractMutationData<string>(result);
    if (!styleId) {
      throw new KernelError('COMPUTE_ERROR', 'Failed to create table style');
    }
    return styleId;
  }

  async update(name: string, style: Partial<TableStyleConfig>): Promise<void> {
    // Rust expects a full CustomTableStyleConfig (with id/name). Fetch the
    // existing style, shallow-merge the caller's updates on top, then send.
    const allStyles = await this.ctx.computeBridge.getAllCustomTableStyles();
    const existing = allStyles.find((s) => s.name === name || s.id === name);
    if (!existing) {
      throw new Error(`Table style "${name}" not found`);
    }
    const merged: TableStyleInfo = { ...existing, ...style };
    await this.ctx.computeBridge.updateCustomTableStyle(name, merged);
  }

  async remove(name: string): Promise<void> {
    await this.ctx.computeBridge.deleteCustomTableStyle(name);
  }

  async getDefault(): Promise<string | undefined> {
    return getDefaultTableStyleId(this.ctx);
  }

  async setDefault(name: string | undefined): Promise<void> {
    return setDefaultTableStyleId(this.ctx, name);
  }

  async duplicate(name: string, newName: string): Promise<TableStyleInfo> {
    const duplicated = await duplicateCustomTableStyle(this.ctx, name, newName);
    return duplicated;
  }
}
