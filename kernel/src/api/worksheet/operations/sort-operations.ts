/**
 * Sort Operations Module
 *
 * Extracted from SheetAPI for better modularity.
 * Delegates sorting to the Rust compute core via the domain Sorting module.
 *
 */

import type {
  BridgeSortCriterion,
  BridgeSortOptions,
  SortOrder,
} from '../../../bridges/compute/compute-types.gen';
import type { MutationAdmissionOptions } from '../../../bridges/compute';
import type { CellValue, SheetId } from '@mog-sdk/contracts/core';
import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';
import { KernelError } from '../../../errors';
import { isValidRange, normalizeRange } from '../../internal/utils';
import { createVersionOperationContext } from '../../internal/version-operation-context';

import type { ApiSortOptions, CellRange, DocumentContext } from './shared';

type SortMutationOptions = MutationAdmissionOptions & {
  readonly operationContext: VersionOperationContext;
};

const SORT_DOMAIN_IDS = ['sorts'] as const;
const SORT_CF_REPAIR_DOMAIN_IDS = ['sorts', 'conditional-formatting'] as const;

/** Map API-level `'asc'`/`'desc'` to bridge-level `SortOrder`. */
function toSortOrder(dir: string): SortOrder {
  return dir === 'asc' ? 'asc' : 'desc';
}

// ==========================================================================
// Sort Operations (Stream A1: Sort System)
// ==========================================================================

/**
 * Sort a range of cells.
 *
 * Sorts the data in a range based on one or more columns.
 * Delegates to ComputeBridge via the domain Sorting module.
 * The sort awaits the bridge mutation so callers can read sorted data immediately.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet identifier
 * @param range - The range to sort
 * @param options - Sort options specifying columns and directions
 * @throws KernelError if the range or sort criteria are invalid
 */
export async function sortRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
  options: ApiSortOptions,
): Promise<void> {
  if (!isValidRange(range)) {
    throw KernelError.from(
      null,
      'COMPUTE_ERROR',
      `Invalid range: (${range.startRow},${range.startCol})-(${range.endRow},${range.endCol})`,
    );
  }

  if (!options.sortBy || options.sortBy.length === 0) {
    throw KernelError.from(null, 'COMPUTE_ERROR', 'At least one sort criterion is required');
  }

  const normalized = normalizeRange(range);

  // Build sort criteria from API options (column-position-based).
  // The bridge expects a discriminated `mode` that mirrors the Rust
  // `BridgeSortMode` tagged union: `value` (with optional customList),
  // `cellColor` / `fontColor` (with target + position). Forward each
  // variant's full payload — the kernel layer no longer drops fields.
  const criteria: BridgeSortCriterion[] = options.sortBy
    .filter((c) => c.column >= normalized.startCol && c.column <= normalized.endCol)
    .map((c): BridgeSortCriterion => {
      const base = {
        column: c.column,
        direction: toSortOrder(c.direction),
        caseSensitive: c.caseSensitive ?? false,
      };
      if (c.sortBy === 'cellColor' || c.sortBy === 'fontColor') {
        return {
          ...base,
          mode: {
            kind: c.sortBy,
            target: c.targetColor,
            position: c.colorPosition,
          },
        };
      }
      // Default value branch — `c.sortBy` is 'value' or undefined.
      // The discriminated-union narrowing here is too lossy for the
      // optional discriminator, so reach for `customList` via an
      // explicit `'customList' in c` test.
      const customList =
        'customList' in c ? (c as { customList?: CellValue[] }).customList : undefined;
      return {
        ...base,
        mode: {
          kind: 'value',
          customList,
        },
      };
    });

  if (criteria.length === 0) {
    return;
  }

  // Await the bridge call so callers can wait for the sort to complete.
  // (Previously fire-and-forget, which caused headless/API reads to see stale data.)
  const sortOptions: BridgeSortOptions = {
    criteria,
    hasHeaders: options.hasHeaders ?? false,
    visibleRowsOnly: options.visibleRowsOnly ?? false,
  };

  // Detect CF overlap BEFORE the sort so we can fix CF state after.
  //
  // Two bugs conspire when sorting a range that overlaps CF rules:
  //
  // Bug 1 (binary format mismatch): The pre-built WASM's sort_range emits
  // full-viewport-binary blobs (serialize_viewport_binary) inside the
  // multi-viewport-patches envelope, but TS's applyMultiViewportPatches feeds
  // each blob to BinaryMutationReader which expects mutation format. For sort
  // ranges starting at row 0, BinaryMutationReader reads patchCount=0 and
  // skips all updates. Fix: forceRefreshAllViewports after sort.
  // (The Rust source in features.rs is fixed to always use flush_viewport_patches,
  // but the pre-built WASM predates that fix.)
  //
  // Bug 2 (stale range_identities): After sort, CellIds physically move in the
  // YRS data model. CF rule ranges stored as range_identities (CellId-based)
  // resolve to wrong positions via the CellMirror. The CF cache is re-evaluated
  // with the moved CellIds, so cells at the "original" corner positions no
  // longer match the CF rule. Fix: clear range_identities on each overlapping
  // CF format so refresh_cf_cache falls back to position-based ranges (which
  // are not affected by sort).
  let cfOverlaps = false;
  let overlappingFormatIds: string[] = [];
  try {
    const cfRules = await ctx.computeBridge.getAllCfRules(sheetId);
    const overlapping = cfRules.filter((cf) =>
      cf.ranges.some(
        (r) =>
          r.startRow <= normalized.endRow &&
          r.endRow >= normalized.startRow &&
          r.startCol <= normalized.endCol &&
          r.endCol >= normalized.startCol,
      ),
    );
    cfOverlaps = overlapping.length > 0;
    overlappingFormatIds = overlapping.map((cf) => cf.id);
  } catch {
    // If we can't read CF rules, be conservative and skip the post-sort fix
    // rather than blocking the sort.
    cfOverlaps = false;
  }

  const sortAdmissionOptions = cfOverlaps
    ? ensureSortMutationGroup(createSortMutationOptions(ctx, sheetId, 'sorts.sortRange'))
    : createSortMutationOptions(ctx, sheetId, 'sorts.sortRange');
  const sortGroupId = sortAdmissionOptions.operationContext.groupId;

  await ctx.computeBridge.sortRange(
    sheetId,
    normalized.startRow,
    normalized.startCol,
    normalized.endRow,
    normalized.endCol,
    sortOptions,
    sortAdmissionOptions,
  );

  if (cfOverlaps) {
    // Fix Bug 2: clear stale range_identities on each overlapping CF format.
    // updateCfRule with the format ID calls cf_store::update_conditional_format
    // (generic JSON merge), setting range_identities = null. The subsequent
    // refresh_cf_cache inside that bridge call then falls back to position-based
    // ranges, which are unaffected by sort.
    for (const formatId of overlappingFormatIds) {
      try {
        await ctx.computeBridge.updateCfRule(
          sheetId,
          formatId,
          { rangeIdentities: null },
          createSortMutationOptions(
            ctx,
            sheetId,
            'sorts.sortRange.repairConditionalFormatting',
            SORT_CF_REPAIR_DOMAIN_IDS,
            sortGroupId,
          ),
        );
      } catch {
        // Non-fatal: forceRefreshAllViewports below may still partially recover.
      }
    }
    // Fix Bug 1: force-refresh viewports to pick up the corrected CF colors
    // and bypass the binary-format-mismatch issue in the pre-built WASM.
    await ctx.computeBridge.forceRefreshAllViewports();
  }
}

function createSortMutationOptions(
  ctx: DocumentContext,
  sheetId: SheetId,
  operationIdPrefix: string,
  domainIds: readonly string[] = SORT_DOMAIN_IDS,
  groupId?: string,
): SortMutationOptions {
  return {
    operationContext: createVersionOperationContext(ctx, {
      operationIdPrefix,
      sheetIds: [sheetId],
      domainIds,
      groupId,
    }),
  };
}

function ensureSortMutationGroup(options: SortMutationOptions): SortMutationOptions {
  const groupId = options.operationContext.groupId ?? options.operationContext.operationId;
  return {
    operationContext: {
      ...options.operationContext,
      groupId,
    },
  };
}
