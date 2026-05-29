/**
 * WorkbookPivotTableStylesImpl -- Pivot table style presets and default style management.
 *
 * Delegates to ComputeBridge for Rust-backed storage of the default pivot table style.
 */
import type { WorkbookPivotTableStyles, PivotTableStyleInfo } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import {
  pivotStyleIdForCompute,
  publicPivotStyleId,
} from '../../domain/pivots/style-normalization';

const BUILT_IN_PIVOT_STYLES: string[] = [];
for (const prefix of ['PivotStyleLight', 'PivotStyleMedium', 'PivotStyleDark']) {
  for (let i = 1; i <= 28; i++) {
    BUILT_IN_PIVOT_STYLES.push(`${prefix}${i}`);
  }
}

export class WorkbookPivotTableStylesImpl implements WorkbookPivotTableStyles {
  constructor(private readonly ctx: DocumentContext) {}

  async getDefault(): Promise<string> {
    const style = await this.ctx.computeBridge.getDefaultPivotTableStyle();
    return publicPivotStyleId(style) ?? 'PivotStyleLight16';
  }

  async setDefault(style: string | null): Promise<void> {
    await this.ctx.computeBridge.setDefaultPivotTableStyle(pivotStyleIdForCompute(style));
  }

  async getCount(): Promise<number> {
    return BUILT_IN_PIVOT_STYLES.length;
  }

  async getItem(name: string): Promise<PivotTableStyleInfo | null> {
    const match = BUILT_IN_PIVOT_STYLES.find((s) => s === name);
    if (!match) return null;
    const defaultStyle = await this.getDefault();
    return { name: match, isDefault: match === defaultStyle };
  }

  async list(): Promise<PivotTableStyleInfo[]> {
    const defaultStyle = await this.getDefault();
    return BUILT_IN_PIVOT_STYLES.map((name) => ({
      name,
      isDefault: name === defaultStyle,
    }));
  }
}
