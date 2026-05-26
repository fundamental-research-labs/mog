/**
 * WorkbookSlicerStylesImpl -- Default slicer style management sub-API implementation.
 *
 * Delegates to ComputeBridge for Rust-backed storage of the default slicer style
 * and named slicer style registry (custom styles).
 * Enumerates the fixed set of Excel built-in slicer style presets.
 */
import type {
  WorkbookSlicerStyles,
  SlicerStyleInfo,
  NamedSlicerStyle,
} from '@mog-sdk/contracts/api';
import type { SlicerCustomStyle } from '@mog-sdk/contracts/data/slicers';

import { extractMutationData } from '../../bridges/compute/compute-core';
import type { DocumentContext } from '../../context';
import { KernelError } from '../../errors';

const BUILT_IN_SLICER_STYLES = [
  'light1',
  'light2',
  'light3',
  'light4',
  'light5',
  'light6',
  'dark1',
  'dark2',
  'dark3',
  'dark4',
  'dark5',
  'dark6',
  'other1',
  'other2',
] as const;

/**
 * Dependencies injected from WorkbookImpl.
 */
export interface WorkbookSlicerStylesDeps {
  ctx: DocumentContext;
}

export class WorkbookSlicerStylesImpl implements WorkbookSlicerStyles {
  constructor(private readonly deps: WorkbookSlicerStylesDeps) {}

  async getDefault(): Promise<string> {
    const style = await this.deps.ctx.computeBridge.getDefaultSlicerStyle();
    return style ?? 'light1';
  }

  async setDefault(style: string | null): Promise<void> {
    await this.deps.ctx.computeBridge.setDefaultSlicerStyle(style);
  }

  async getCount(): Promise<number> {
    return BUILT_IN_SLICER_STYLES.length;
  }

  async getItem(name: string): Promise<SlicerStyleInfo | null> {
    const match = BUILT_IN_SLICER_STYLES.find((s) => s === name);
    if (!match) return null;
    const defaultStyle = await this.getDefault();
    return { name: match, isDefault: match === defaultStyle };
  }

  async list(): Promise<SlicerStyleInfo[]> {
    const defaultStyle = await this.getDefault();
    return BUILT_IN_SLICER_STYLES.map((name) => ({
      name,
      isDefault: name === defaultStyle,
    }));
  }

  // --- Named slicer style registry (custom styles) ---

  async add(name: string, style: SlicerCustomStyle, makeUniqueName?: boolean): Promise<string> {
    const result = await this.deps.ctx.computeBridge.addSlicerStyle(
      name,
      style,
      makeUniqueName ?? false,
    );
    const resolved = extractMutationData<string>(result);
    if (resolved !== undefined) return resolved;
    // If makeUniqueName was true and the bridge didn't return the resolved name,
    // we can't know what name was actually assigned — throw rather than returning
    // the original (potentially wrong) name.
    if (makeUniqueName) {
      throw new Error(
        `addSlicerStyle with makeUniqueName=true did not return the resolved name for "${name}"`,
      );
    }
    return name;
  }

  async get(name: string): Promise<NamedSlicerStyle | null> {
    return this.deps.ctx.computeBridge.getSlicerStyle(name);
  }

  async remove(name: string): Promise<void> {
    await this.deps.ctx.computeBridge.deleteSlicerStyle(name);
  }

  async duplicate(name: string): Promise<string> {
    const result = await this.deps.ctx.computeBridge.duplicateSlicerStyle(name);
    const styleId = extractMutationData<string>(result);
    if (!styleId) {
      throw new KernelError('COMPUTE_ERROR', 'Failed to duplicate slicer style');
    }
    return styleId;
  }
}
