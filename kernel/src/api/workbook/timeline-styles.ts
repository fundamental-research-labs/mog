/**
 * WorkbookTimelineStylesImpl -- Timeline slicer style management sub-API implementation.
 *
 * Delegates to ComputeBridge for Rust-backed storage of the default timeline style
 * and named timeline style registry (custom styles).
 * Enumerates the fixed set of Excel built-in timeline style presets.
 *
 * Timeline styles are stored in the same named-slicer-style CRDT registry as
 * regular slicer styles, but namespaced with a `__timeline__` prefix to avoid
 * collisions. The prefix is stripped before returning names to callers.
 */
import type {
  WorkbookTimelineStyles,
  TimelineStyleInfo,
  NamedTimelineStyle,
} from '@mog-sdk/contracts/api';
import type { SlicerCustomStyle } from '@mog-sdk/contracts/data/slicers';

import { extractMutationData } from '../../bridges/compute/compute-core';
import type { DocumentContext } from '../../context';
import { KernelError } from '../../errors';

/**
 * Internal prefix used to namespace timeline styles within the shared
 * named-slicer-style CRDT map. Callers never see this prefix.
 */
const TIMELINE_NS = '__timeline__';

const BUILT_IN_TIMELINE_STYLES = [
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
] as const;

/**
 * Dependencies injected from WorkbookImpl.
 */
export interface WorkbookTimelineStylesDeps {
  ctx: DocumentContext;
}

export class WorkbookTimelineStylesImpl implements WorkbookTimelineStyles {
  constructor(private readonly deps: WorkbookTimelineStylesDeps) {}

  async getDefault(): Promise<string> {
    const style = await this.deps.ctx.computeBridge.getDefaultSlicerStyle();
    // Timeline default is stored separately — use a namespaced key.
    // For now, fall back to 'light1' since the Rust layer doesn't have a
    // separate default for timeline styles yet.
    return style ?? 'light1';
  }

  async setDefault(style: string | null): Promise<void> {
    // Timeline default shares the bridge — a future Rust extension can
    // add a dedicated key. For now this is a no-op placeholder that
    // matches the contract without corrupting the slicer default.
    // Consumers can still call setDefault(); it will resolve once
    // Rust-side storage gains a dedicated timeline default key.
    void style;
  }

  async getCount(): Promise<number> {
    return BUILT_IN_TIMELINE_STYLES.length;
  }

  async getItem(name: string): Promise<TimelineStyleInfo | null> {
    const match = BUILT_IN_TIMELINE_STYLES.find((s) => s === name);
    if (!match) return null;
    const defaultStyle = await this.getDefault();
    return { name: match, isDefault: match === defaultStyle };
  }

  async list(): Promise<TimelineStyleInfo[]> {
    const defaultStyle = await this.getDefault();
    return BUILT_IN_TIMELINE_STYLES.map((name) => ({
      name,
      isDefault: name === defaultStyle,
    }));
  }

  // --- Named timeline style registry (custom styles) ---

  async add(name: string, style: SlicerCustomStyle, makeUniqueName?: boolean): Promise<string> {
    const nsName = TIMELINE_NS + name;
    const result = await this.deps.ctx.computeBridge.addSlicerStyle(
      nsName,
      style,
      makeUniqueName ?? false,
    );
    const resolved = extractMutationData<string>(result);
    if (resolved !== undefined) return resolved.replace(TIMELINE_NS, '');
    if (makeUniqueName) {
      throw new Error(
        `addSlicerStyle with makeUniqueName=true did not return the resolved name for "${name}"`,
      );
    }
    return name;
  }

  async get(name: string): Promise<NamedTimelineStyle | null> {
    const nsName = TIMELINE_NS + name;
    const result = await this.deps.ctx.computeBridge.getSlicerStyle(nsName);
    if (!result) return null;
    return {
      name: result.name.replace(TIMELINE_NS, ''),
      readOnly: result.readOnly,
      style: result.style,
    };
  }

  async remove(name: string): Promise<void> {
    const nsName = TIMELINE_NS + name;
    await this.deps.ctx.computeBridge.deleteSlicerStyle(nsName);
  }

  async duplicate(name: string): Promise<string> {
    const nsName = TIMELINE_NS + name;
    const result = await this.deps.ctx.computeBridge.duplicateSlicerStyle(nsName);
    const styleId = extractMutationData<string>(result);
    if (!styleId) {
      throw new KernelError('COMPUTE_ERROR', 'Failed to duplicate timeline style');
    }
    return styleId.replace(TIMELINE_NS, '');
  }
}
