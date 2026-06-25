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
  VersionDiffEntry,
  VersionDiffValue,
  VersionMergeChange,
  VersionMergeConflict,
  WorkbookCommitSummary,
  WorkbookVersionReviewDiffChange,
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

export const BUILT_IN_TIMELINE_STYLES = [
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

export type TimelineStyleName = (typeof BUILT_IN_TIMELINE_STYLES)[number];

export const DEFAULT_TIMELINE_STYLE: TimelineStyleName = 'light1';

export type VersionTimelineVersionEntry = WorkbookCommitSummary;
export type VersionTimelineDiffEntry = VersionDiffEntry | WorkbookVersionReviewDiffChange;
export type VersionTimelineMergeEntry = VersionMergeChange | VersionMergeConflict;

export type VersionTimelineStyleEntry =
  | { readonly kind: 'version'; readonly entry: VersionTimelineVersionEntry }
  | { readonly kind: 'diff'; readonly entry: VersionTimelineDiffEntry }
  | { readonly kind: 'merge'; readonly entry: VersionTimelineMergeEntry };

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
    return style ?? DEFAULT_TIMELINE_STYLE;
  }

  async setDefault(style: string | null): Promise<void> {
    await this.deps.ctx.computeBridge.setDefaultSlicerStyle(style);
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
    if (resolved !== undefined) return toPublicTimelineStyleName(resolved);
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
      name: toPublicTimelineStyleName(result.name),
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
    return toPublicTimelineStyleName(styleId);
  }
}

export function mapTimelineEntryStyle(entry: VersionTimelineStyleEntry): TimelineStyleName {
  switch (entry.kind) {
    case 'version':
      return timelineStyleForVersionEntry(entry.entry);
    case 'diff':
      return timelineStyleForDiffEntry(entry.entry);
    case 'merge':
      return timelineStyleForMergeEntry(entry.entry);
  }
}

export function mapTimelineEntryStyleInfo(entry: VersionTimelineStyleEntry): TimelineStyleInfo {
  const name = mapTimelineEntryStyle(entry);
  return {
    name,
    isDefault: name === DEFAULT_TIMELINE_STYLE,
  };
}

export function timelineStyleForVersionEntry(
  entry: VersionTimelineVersionEntry,
): TimelineStyleName {
  if (hasDiagnostics(entry)) return 'dark5';
  if (entry.orphan === true) return 'dark6';
  if (entry.parents.length > 1) return 'dark1';
  if (entry.parents.length === 0) return 'light1';
  return 'light2';
}

export function timelineStyleForDiffEntry(entry: VersionTimelineDiffEntry): TimelineStyleName {
  if (hasDiagnostics(entry)) return 'dark5';

  const reviewKind = reviewDiffChangeKind(entry);
  if (reviewKind) return styleForReviewDiffChangeKind(reviewKind);

  const diffEntry = entry as VersionDiffEntry;
  if (isRedactedDiffValue(diffEntry.structural) || isRedactedDiffValue(diffEntry.before)) {
    return 'dark5';
  }
  if (isRedactedDiffValue(diffEntry.after)) return 'dark5';
  if (
    diffEntry.structural.kind === 'metadata' &&
    diffEntry.structural.propertyPath[0] === 'order'
  ) {
    return 'light5';
  }
  if (isEmptyDiffValue(diffEntry.before) && !isEmptyDiffValue(diffEntry.after)) return 'light3';
  if (!isEmptyDiffValue(diffEntry.before) && isEmptyDiffValue(diffEntry.after)) return 'light6';
  return 'light4';
}

export function timelineStyleForMergeEntry(entry: VersionTimelineMergeEntry): TimelineStyleName {
  if (isVersionMergeConflict(entry)) return 'dark6';
  if (hasDiagnostics(entry)) return 'dark5';
  if (entry.ours && entry.theirs) return 'dark2';
  return 'dark3';
}

function toPublicTimelineStyleName(name: string): string {
  return name.startsWith(TIMELINE_NS) ? name.slice(TIMELINE_NS.length) : name;
}

function hasDiagnostics(entry: { readonly diagnostics?: readonly unknown[] }): boolean {
  return Array.isArray(entry.diagnostics) && entry.diagnostics.length > 0;
}

function isVersionMergeConflict(entry: VersionTimelineMergeEntry): entry is VersionMergeConflict {
  return 'conflictId' in entry;
}

function reviewDiffChangeKind(
  entry: VersionTimelineDiffEntry,
): WorkbookVersionReviewDiffChange['kind'] | null {
  return 'target' in entry && 'entity' in entry ? entry.kind : null;
}

function styleForReviewDiffChangeKind(
  kind: WorkbookVersionReviewDiffChange['kind'],
): TimelineStyleName {
  switch (kind) {
    case 'create':
      return 'light3';
    case 'update':
      return 'light4';
    case 'move':
    case 'reorder':
      return 'light5';
    case 'delete':
      return 'light6';
  }
}

function isEmptyDiffValue(value: VersionDiffValue): boolean {
  return (
    value.kind === 'value' &&
    (value.value === null ||
      (typeof value.value === 'object' &&
        value.value !== null &&
        !Array.isArray(value.value) &&
        value.value.kind === 'blank'))
  );
}

function isRedactedDiffValue(value: { readonly kind: string }): boolean {
  return value.kind === 'redacted';
}
