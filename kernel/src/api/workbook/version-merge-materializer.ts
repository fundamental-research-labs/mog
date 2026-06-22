import type {
  CellFormat,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionMergeChange,
  VersionSemanticValue,
} from '@mog-sdk/contracts/api';
import { sheetId as toSheetId, type CellValuePrimitive } from '@mog-sdk/contracts/core';
import type { VersionAuthor, VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { DocumentContext } from '../../context';
import type {
  VersionMergeCommitCapture,
  VersionMergeCommitCaptureInput,
} from '../../document/version-store/commit-service';
import { createVersionObjectRecord } from '../../document/version-store/object-store';
import {
  failedStoreResult,
  versionStoreDiagnostic,
  type VersionStoreDiagnostic,
  type VersionStoreFailure,
} from '../../document/version-store/provider';
import { captureWorkbookSnapshotRootRecord } from '../../document/version-store/snapshot-root-capture';
import { createSnapshotRootMaterializationService } from '../../document/version-store/snapshot-root-materialization-service';
import { createDocumentLifecycleSnapshotRootHydrator } from '../document/snapshot-root-lifecycle-hydrator';
import { parseCellAddress } from '../internal/utils';
import * as CellOps from '../worksheet/operations/cell-operations';
import * as FormatOps from '../worksheet/operations/format-operations';

export const DEFAULT_MERGE_COMMIT_MATERIALIZER_KIND =
  'semantic-cell-merge-commit-materializer.v1';

const MERGE_CAPTURE_AUTHOR: VersionAuthor = Object.freeze({
  authorId: 'mog.version-merge',
  actorKind: 'system',
  displayName: 'Mog Version Merge',
});

export interface SemanticMergeCommitCaptureOptions {
  readonly userTimezone: string;
  readonly now?: () => Date;
}

type ParsedCellMergeChange = {
  readonly kind: 'cellValue';
  readonly change: VersionMergeChange;
  readonly structural: Extract<VersionDiffStructuralMetadata, { readonly kind: 'metadata' }>;
  readonly sheetId: string;
  readonly address: string;
  readonly row: number;
  readonly col: number;
  readonly merged: CellMergeValue;
};

type ParsedDirectFormatMergeChange = {
  readonly kind: 'directCellFormat';
  readonly change: VersionMergeChange;
  readonly structural: Extract<VersionDiffStructuralMetadata, { readonly kind: 'metadata' }>;
  readonly sheetId: string;
  readonly address: string;
  readonly row: number;
  readonly col: number;
  readonly merged: DirectFormatMergeValue;
};

type ParsedMergeChange = ParsedCellMergeChange | ParsedDirectFormatMergeChange;

type CellMergeValue =
  | {
      readonly kind: 'clear';
    }
  | {
      readonly kind: 'formula';
      readonly formula: string;
    }
  | {
      readonly kind: 'scalar';
      readonly value: CellValuePrimitive;
    };

type DirectFormatMergeValue =
  | {
      readonly kind: 'clear';
    }
  | {
      readonly kind: 'format';
      readonly format: CellFormat;
    };

export function createSemanticMergeCommitCapture(
  options: SemanticMergeCommitCaptureOptions,
): VersionMergeCommitCapture {
  const now = options.now ?? (() => new Date());
  return async (input) => {
    const parsed = parseMergeChanges(input);
    if (!parsed.ok) return parsed.failure;

    const createdAt = now().toISOString();
    const materialization = await createSnapshotRootMaterializationService({
      provider: input.provider,
      hydrator: createDocumentLifecycleSnapshotRootHydrator({
        userTimezone: options.userTimezone,
        documentIdPrefix: `version-merge-${shortCommitId(input.ours)}`,
      }),
    }).materializeCommitSnapshotRoot(input.ours);

    if (!materialization.ok) {
      return failedStoreResult(
        [
          versionStoreDiagnostic('VERSION_PROVIDER_FAILED', {
            operation: 'commitGraphWrite',
            documentScope: input.provider.documentScope,
            namespace: input.namespace,
            refName: input.currentRef.name,
            commitId: input.ours,
            safeMessage:
              'Version merge materialization could not hydrate the expected target head.',
            recoverability: 'retry',
            mutationGuarantee: 'no-write-attempted',
            details: { cause: materialization.error.code },
          }),
        ],
        'no-write-attempted',
        true,
      );
    }

    const materialized = materialization.materialized;
    try {
      await applyMergeChanges(materialized.context, input, parsed.changes, createdAt);
      const snapshotRootRecord = await captureWorkbookSnapshotRootRecord(
        input.namespace,
        materialized.context.computeBridge,
      );
      const semanticChangeSetRecord = await createVersionObjectRecord(input.namespace, {
        objectType: 'workbook.semanticChangeSet.v1',
        schemaVersion: 1,
        payloadEncoding: 'mog-canonical-json-v1',
        dependencies: [],
        payload: {
          schemaVersion: 1,
          merge: {
            baseCommitId: input.base,
            oursCommitId: input.ours,
            theirsCommitId: input.theirs,
            targetRef: input.targetRef,
            expectedTargetHead: input.expectedTargetHead,
            resolutionCount: input.resolutionCount,
            materializer: DEFAULT_MERGE_COMMIT_MATERIALIZER_KIND,
          },
          changes: parsed.changes.map((entry) => semanticMergeChangeRecord(entry.change)),
        },
      });
      const mutationSegmentRecords = [
        await createVersionObjectRecord(input.namespace, {
          objectType: 'workbook.mutationSegment.v1',
          schemaVersion: 1,
          payloadEncoding: 'mog-canonical-json-v1',
          dependencies: [],
          payload: mergeMutationSegmentPayload(input, parsed.changes, createdAt),
        }),
      ];

      return {
        status: 'success' as const,
        input: {
          snapshotRootRecord,
          semanticChangeSetRecord,
          mutationSegmentRecords,
          author: MERGE_CAPTURE_AUTHOR,
          createdAt,
          completenessDiagnostics: [],
        },
      };
    } catch (error) {
      return failedStoreResult(
        [
          versionStoreDiagnostic('VERSION_PROVIDER_FAILED', {
            operation: 'commitGraphWrite',
            documentScope: input.provider.documentScope,
            namespace: input.namespace,
            refName: input.currentRef.name,
            commitId: input.ours,
            safeMessage:
              'Version merge materialization failed while applying the merge plan.',
            recoverability: 'retry',
            mutationGuarantee: 'no-write-attempted',
            details: { cause: errorName(error) },
          }),
        ],
        'no-write-attempted',
        true,
      );
    } finally {
      await disposeQuietly(() => materialized.dispose());
    }
  };
}

function parseMergeChanges(
  input: VersionMergeCommitCaptureInput,
):
  | {
      readonly ok: true;
      readonly changes: readonly ParsedMergeChange[];
    }
  | {
      readonly ok: false;
      readonly failure: VersionStoreFailure;
    } {
  const parsed: ParsedMergeChange[] = [];
  for (let index = 0; index < input.changes.length; index++) {
    const change = input.changes[index];
    const structural = parseCellStructural(change.structural) ?? parseDirectFormatStructural(change.structural);
    if (!structural) {
      return unsupportedMergeChange(input, index, change.structural);
    }
    const target = parseCellEntity(structural.entityId);
    if (!target) {
      return unsupportedMergeChange(input, index, structural, {
        reason: 'unsupportedEntityId',
      });
    }
    if (structural.domain === 'cells.formats.direct') {
      const merged = parseDirectFormatMergeValue(change.merged);
      if (!merged) {
        return unsupportedMergeChange(input, index, structural, {
          reason: 'unsupportedMergedValue',
        });
      }
      parsed.push({
        kind: 'directCellFormat',
        change,
        structural,
        sheetId: target.sheetId,
        address: target.address,
        row: target.row,
        col: target.col,
        merged,
      });
      continue;
    }
    const merged = parseCellMergeValue(change.merged);
    if (!merged) {
      return unsupportedMergeChange(input, index, structural, {
        reason: 'unsupportedMergedValue',
      });
    }
    parsed.push({
      kind: 'cellValue',
      change,
      structural,
      sheetId: target.sheetId,
      address: target.address,
      row: target.row,
      col: target.col,
      merged,
    });
  }
  return { ok: true, changes: parsed };
}

function parseCellStructural(
  structural: VersionDiffStructuralMetadata,
): Extract<VersionDiffStructuralMetadata, { readonly kind: 'metadata' }> | null {
  if (structural.kind !== 'metadata') return null;
  if (structural.domain !== 'cell' && structural.domain !== 'cells.values') return null;
  if (
    structural.propertyPath.length !== 0 &&
    !(structural.propertyPath.length === 1 && structural.propertyPath[0] === 'value')
  ) {
    return null;
  }
  return structural;
}

function parseDirectFormatStructural(
  structural: VersionDiffStructuralMetadata,
): Extract<VersionDiffStructuralMetadata, { readonly kind: 'metadata' }> | null {
  if (structural.kind !== 'metadata') return null;
  if (structural.domain !== 'cells.formats.direct') return null;
  if (structural.propertyPath.length !== 1 || structural.propertyPath[0] !== 'format') {
    return null;
  }
  return structural;
}

function parseCellEntity(entityId: string):
  | {
      readonly sheetId: string;
      readonly address: string;
      readonly row: number;
      readonly col: number;
    }
  | null {
  const separator = entityId.lastIndexOf('!');
  if (separator <= 0 || separator === entityId.length - 1) return null;
  const sheetId = entityId.slice(0, separator);
  const address = entityId.slice(separator + 1);
  const parsed = parseCellAddress(address);
  if (!parsed) return null;
  return { sheetId, address, row: parsed.row, col: parsed.col };
}

function parseCellMergeValue(value: VersionDiffValue): CellMergeValue | null {
  if (value.kind !== 'value') return null;
  return parseSemanticCellValue(value.value);
}

function parseDirectFormatMergeValue(value: VersionDiffValue): DirectFormatMergeValue | null {
  if (value.kind !== 'value') return null;
  if (value.value === null) return { kind: 'clear' };
  const plain = semanticFormatJsonValue(value.value);
  if (!isMaterializableCellFormat(plain)) return null;
  return { kind: 'format', format: plain };
}

function parseSemanticCellValue(value: VersionSemanticValue): CellMergeValue | null {
  if (value === null) return { kind: 'clear' };
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { kind: 'scalar', value };
  }
  if (typeof value !== 'object') return null;
  if (value.kind === 'blank') return { kind: 'clear' };
  if (value.kind === 'formula') {
    return typeof value.formula === 'string' && value.formula.length > 0
      ? { kind: 'formula', formula: value.formula }
      : null;
  }
  return null;
}

async function applyMergeChanges(
  ctx: DocumentContext,
  input: VersionMergeCommitCaptureInput,
  changes: readonly ParsedMergeChange[],
  createdAt: string,
): Promise<void> {
  for (let index = 0; index < changes.length; index++) {
    const change = changes[index];
    const operationContext = mergeOperationContext(input, change, index, createdAt);
    const sheet = toSheetId(change.sheetId);
    if (change.kind === 'directCellFormat') {
      if (change.merged.kind === 'clear') {
        const result = await FormatOps.clearFormat(
          ctx,
          sheet,
          change.row,
          change.col,
          { operationContext },
        );
        assertFormatOperationSuccess(result, 'clearFormat');
        continue;
      }
      const result = await FormatOps.setCellProperties(
        ctx,
        sheet,
        [{ row: change.row, col: change.col, format: change.merged.format }],
        { operationContext },
      );
      assertFormatOperationSuccess(result, 'setCellProperties');
      continue;
    }
    if (change.merged.kind === 'formula') {
      await CellOps.setCell(ctx, sheet, change.row, change.col, change.merged.formula, {
        operationContext,
      });
      continue;
    }
    await CellOps.setCell(
      ctx,
      sheet,
      change.row,
      change.col,
      change.merged.kind === 'clear' ? null : change.merged.value,
      { operationContext },
    );
  }
}

function assertFormatOperationSuccess(
  result: { readonly success: boolean; readonly error?: unknown },
  operation: string,
): void {
  if (!result.success) {
    throw new Error(`${operation} failed during version merge materialization`);
  }
}

function mergeOperationContext(
  input: VersionMergeCommitCaptureInput,
  change: ParsedMergeChange,
  index: number,
  createdAt: string,
): VersionOperationContext {
  return Object.freeze({
    operationId: `version-merge:${shortCommitId(input.ours)}:${shortCommitId(input.theirs)}:${index}`,
    kind: 'merge' as const,
    author: MERGE_CAPTURE_AUTHOR,
    createdAt,
    workbookId: input.namespace.documentId,
    sheetIds: [change.sheetId],
    domainIds: [change.structural.domain],
    groupId: `version-merge:${shortCommitId(input.base)}:${shortCommitId(input.ours)}:${shortCommitId(input.theirs)}`,
    capturePolicy: 'commitEligible' as const,
    writeAdmissionMode: 'capture' as const,
  });
}

function semanticMergeChangeRecord(change: VersionMergeChange) {
  return {
    structural: change.structural,
    before: change.base,
    after: change.merged,
    ...(change.display ? { display: change.display } : {}),
  };
}

function mergeMutationSegmentPayload(
  input: VersionMergeCommitCaptureInput,
  changes: readonly ParsedMergeChange[],
  createdAt: string,
): unknown {
  return {
    schemaVersion: 1,
    segmentId: `merge-${shortCommitId(input.ours)}-${shortCommitId(input.theirs)}`,
    operation: 'version.applyMerge',
    operationContext: {
      operationId: `version-merge:${shortCommitId(input.ours)}:${shortCommitId(input.theirs)}`,
      kind: 'merge',
      author: MERGE_CAPTURE_AUTHOR,
      createdAt,
      workbookId: input.namespace.documentId,
      sheetIds: Array.from(new Set(changes.map((change) => change.sheetId))).sort(),
      domainIds: Array.from(new Set(changes.map((change) => change.structural.domain))).sort(),
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
    },
    capturedAt: createdAt,
    baseCommitId: input.base,
    oursCommitId: input.ours,
    theirsCommitId: input.theirs,
    targetRef: input.targetRef,
    expectedTargetHead: input.expectedTargetHead,
    resolutionCount: input.resolutionCount,
    materializer: DEFAULT_MERGE_COMMIT_MATERIALIZER_KIND,
    changeIds: changes.map((change) => change.structural.changeId),
    directEdits: changes.map((change) => ({
      sheetId: change.sheetId,
      row: change.row,
      col: change.col,
      address: change.address,
    })),
  };
}

function unsupportedMergeChange(
  input: VersionMergeCommitCaptureInput,
  index: number,
  structural: VersionDiffStructuralMetadata,
  details: Readonly<Record<string, string | number | boolean | null>> = {},
): { readonly ok: false; readonly failure: VersionStoreFailure } {
  return {
    ok: false,
    failure: failedStoreResult(
      [
        versionStoreDiagnostic('VERSION_MISSING_CHANGE_SET', {
          operation: 'commitGraphWrite',
          documentScope: input.provider.documentScope,
          namespace: input.namespace,
          refName: input.currentRef.name,
          commitId: input.ours,
          safeMessage:
            'Version merge materialization supports only cell value merge changes in this slice.',
          recoverability: 'unsupported',
          mutationGuarantee: 'no-write-attempted',
          details: {
            itemIndex: index,
            structuralKind: structural.kind,
            domain: structural.kind === 'metadata' ? structural.domain : 'redacted',
            ...details,
          },
        }),
      ],
      'no-write-attempted',
    ),
  };
}

async function disposeQuietly(dispose: () => Promise<void>): Promise<void> {
  try {
    await dispose();
  } catch {
    // Best-effort cleanup of the scratch merge lifecycle.
  }
}

function shortCommitId(commitId: string): string {
  return commitId.replace(/^commit:sha256:/, '').slice(0, 12);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function semanticFormatJsonValue(value: VersionSemanticValue, depth = 0): unknown {
  if (depth > 16) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (!isRecord(value)) return undefined;
  if (value.kind === 'array') {
    if (!Array.isArray(value.values)) return undefined;
    const values = value.values.map((entry) => semanticFormatJsonValue(entry, depth + 1));
    return values.some((entry) => entry === undefined) ? undefined : values;
  }
  if (value.kind === 'object') {
    if (!Array.isArray(value.fields)) return undefined;
    const record: Record<string, unknown> = {};
    for (const field of value.fields) {
      if (!isRecord(field) || typeof field.key !== 'string') return undefined;
      const mapped = semanticFormatJsonValue(field.value as VersionSemanticValue, depth + 1);
      if (mapped === undefined) return undefined;
      record[field.key] = mapped;
    }
    return record;
  }
  return undefined;
}

function isMaterializableCellFormat(value: unknown): value is CellFormat {
  return isRecord(value) && Object.keys(value).length > 0 && value.kind !== 'Removed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
