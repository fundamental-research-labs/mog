import type { IKernelContext } from '@mog-sdk/contracts/kernel';
import type {
  CapturePolicy,
  VersionActorKind,
  VersionDomainClass,
  VersionOperationContext,
  VersionOperationKind,
  VersionRedactionPolicy,
  VersionRolloutStage,
  VersionShadowObservationOptions,
  VersionShadowObservationRecord,
  VersionShadowObservationSink,
  VersionWriteAdmissionMode,
} from '@mog-sdk/contracts/versioning';
import type { MutationResult } from './compute-types.gen';
import { classifyWriteOperation } from './operation-classification';
import type {
  DirectEditPosition,
  DirectEditRange,
  VersionMutationCaptureRecordInput,
} from './mutation-admission';

const DEFAULT_ENVIRONMENT_ID = 'runtime';
const DEFAULT_REDACTION_POLICY: VersionRedactionPolicy = 'metadata-only';

let nextObservationSequence = 1;

interface VersionShadowObservationContext {
  versioning?: {
    readonly shadowObservationSink?: VersionShadowObservationSink;
    readonly shadowObservationOptions?: VersionShadowObservationOptions;
  };
  clock?: {
    readonly now?: () => number;
    readonly dateNow?: () => number;
  };
  workbookLinkScope?: () => { readonly requestingDocumentId?: string };
}

export function recordVersionMutationShadowObservation(
  ctx: IKernelContext,
  input: VersionMutationCaptureRecordInput,
): void | Promise<void> {
  const runtime = ctx as IKernelContext & VersionShadowObservationContext;
  const sink = runtime.versioning?.shadowObservationSink;
  if (!sink) return undefined;
  return sink.recordObservation(buildVersionMutationShadowObservation(runtime, input));
}

function buildVersionMutationShadowObservation(
  ctx: IKernelContext & VersionShadowObservationContext,
  input: VersionMutationCaptureRecordInput,
): VersionShadowObservationRecord {
  const operationContext = input.operationContext;
  const classification = classifyWriteOperation(input.operation);
  const options = ctx.versioning?.shadowObservationOptions;
  const observedAtMs = safeTimestamp(ctx);
  const observedAt = new Date(observedAtMs).toISOString();
  const operationId =
    operationContext?.operationId ?? `uncontexted.${input.operation}.${observedAtMs}`;
  const redactionPolicy = options?.redactionPolicy ?? DEFAULT_REDACTION_POLICY;
  const diagnosticCodes = diagnosticCodesFromMutationResult(input.result);
  const affectedSheetIds = affectedSheetIdsFromMutation(input);

  return {
    schemaVersion: 1,
    recordKind: 'version-shadow-observation',
    observationId: `shadow-observation:${observedAtMs}:${nextObservationSequence++}`,
    observedAt,
    environmentId: options?.environmentId ?? DEFAULT_ENVIRONMENT_ID,
    ...documentIdField(ctx),
    rolloutStage: rolloutStageFrom(options, operationContext),
    captureMode: options?.captureMode ?? 'shadow',
    sampleStatus: 'observed',
    operation: {
      command: input.operation,
      ...(operationContext?.operationId ? { operationId: operationContext.operationId } : {}),
      ...(operationContext?.groupId ? { operationGroupId: operationContext.groupId } : {}),
      kind: operationContext?.kind ?? classification?.operationKind ?? 'mutation',
      entrypointIds: [input.operation],
      domainIds: [...(operationContext?.domainIds ?? [])],
      sheetIds: [...(operationContext?.sheetIds ?? affectedSheetIds)],
      capturePolicy:
        operationContext?.capturePolicy ?? classification?.capturePolicy ?? 'shadowOnly',
      writeAdmissionMode:
        operationContext?.writeAdmissionMode ?? classification?.writeAdmissionMode ?? 'shadowOnly',
      ...(classification?.domainClass ? { domainClass: classification.domainClass } : {}),
      ...(classification?.invocation ? { invocation: classification.invocation } : {}),
    },
    actor: actorProjection(operationContext),
    result: {
      changedCellCount: input.result.recalc?.changedCells?.length ?? 0,
      directEditCount: input.directEdits?.length ?? 0,
      directEditRangeCount: input.directEditRanges?.length ?? 0,
      affectedSheetIds,
      sheetChangeCount: arrayLength(
        (input.result as { readonly sheetChanges?: unknown }).sheetChanges,
      ),
      tableChangeCount: arrayLength(input.result.tableChanges),
      pivotChangeCount: arrayLength(input.result.pivotChanges),
      chartChangeCount: arrayLength(
        (input.result as { readonly chartChanges?: unknown }).chartChanges,
      ),
      validationAnnotationCount: input.result.recalc?.validationAnnotations?.length ?? 0,
      diagnosticCodes,
    },
    redaction: {
      policy: redactionPolicy,
      ...(options?.redactionPolicyDigest ? { policyDigest: options.redactionPolicyDigest } : {}),
      omitted: [
        'cellValues',
        'formulaText',
        'authorId',
        'principalId',
        'providerPayload',
        'rawWorkbookBytes',
      ],
    },
    sourceArtifactRefs: sourceArtifactRefs({
      operation: input.operation,
      operationId,
      redactionPolicy,
      result: input.result,
      operationContext,
      domainClass: classification?.domainClass,
      capturePolicy:
        operationContext?.capturePolicy ?? classification?.capturePolicy ?? 'shadowOnly',
      writeAdmissionMode:
        operationContext?.writeAdmissionMode ?? classification?.writeAdmissionMode ?? 'shadowOnly',
      diagnosticCodes,
    }),
  };
}

function safeTimestamp(ctx: VersionShadowObservationContext): number {
  for (const read of [ctx.clock?.dateNow, ctx.clock?.now]) {
    try {
      const value = read?.();
      if (value !== undefined && Number.isFinite(value)) return value;
    } catch {
      // fall through to Date.now
    }
  }
  return Date.now();
}

function documentIdField(ctx: VersionShadowObservationContext): { readonly documentId?: string } {
  try {
    const documentId = ctx.workbookLinkScope?.().requestingDocumentId;
    return typeof documentId === 'string' && documentId.length > 0 ? { documentId } : {};
  } catch {
    return {};
  }
}

function rolloutStageFrom(
  options: VersionShadowObservationOptions | undefined,
  operationContext: VersionOperationContext | undefined,
): VersionRolloutStage {
  return options?.rolloutStage ?? operationContext?.rolloutStage ?? 'shadow-only';
}

function actorProjection(
  operationContext: VersionOperationContext | undefined,
): VersionShadowObservationRecord['actor'] {
  const actorKind = actorKindFrom(operationContext?.author?.actorKind);
  return {
    ...(actorKind ? { actorKind } : {}),
    redactedAuthorClass: actorKind ?? 'unknown',
  };
}

function actorKindFrom(value: unknown): VersionActorKind | 'unknown' | undefined {
  return value === 'user' ||
    value === 'service' ||
    value === 'system' ||
    value === 'migration' ||
    value === 'automation'
    ? value
    : value === undefined
      ? undefined
      : 'unknown';
}

function affectedSheetIdsFromMutation(
  input: Pick<
    VersionMutationCaptureRecordInput,
    'directEdits' | 'directEditRanges' | 'operationContext' | 'result'
  >,
): readonly string[] {
  return sortedUnique([
    ...(input.operationContext?.sheetIds ?? []),
    ...(input.directEdits ?? []).map((edit: DirectEditPosition) => edit.sheetId),
    ...(input.directEditRanges ?? []).map((range: DirectEditRange) => range.sheetId),
    ...(input.result.recalc?.changedCells ?? []).map((cell) => cell.sheetId),
    ...sheetIdsFromArray((input.result as { readonly sheetChanges?: unknown }).sheetChanges),
    ...sheetIdsFromArray(input.result.tableChanges),
    ...sheetIdsFromArray(input.result.pivotChanges),
    ...sheetIdsFromArray((input.result as { readonly chartChanges?: unknown }).chartChanges),
  ]);
}

function sheetIdsFromArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) =>
      typeof item === 'object' && item !== null && 'sheetId' in item
        ? (item as { readonly sheetId?: unknown }).sheetId
        : undefined,
    )
    .filter((sheetId): sheetId is string => typeof sheetId === 'string' && sheetId.length > 0);
}

function diagnosticCodesFromMutationResult(result: MutationResult): readonly string[] {
  const recalcErrors = result.recalc?.errors ?? [];
  const validationAnnotations = result.recalc?.validationAnnotations ?? [];
  return sortedUnique([
    ...recalcErrors.map((error) => codeFrom(error)),
    ...validationAnnotations.flatMap((annotation) =>
      Array.isArray(annotation.errors) ? annotation.errors.map((error) => codeFrom(error)) : [],
    ),
  ]);
}

function codeFrom(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    for (const key of ['code', 'kind', 'type'] as const) {
      const field = (value as Record<string, unknown>)[key];
      if (typeof field === 'string' && field.length > 0) return field;
    }
  }
  return 'unknown-diagnostic';
}

function sourceArtifactRefs(input: {
  readonly operation: string;
  readonly operationId: string;
  readonly redactionPolicy: VersionRedactionPolicy;
  readonly result: MutationResult;
  readonly operationContext?: VersionOperationContext;
  readonly domainClass?: VersionDomainClass;
  readonly capturePolicy: CapturePolicy;
  readonly writeAdmissionMode: VersionWriteAdmissionMode;
  readonly diagnosticCodes: readonly string[];
}): VersionShadowObservationRecord['sourceArtifactRefs'] {
  const operationDigest = opaqueDigest('operation-context', {
    operation: input.operation,
    operationId: input.operationId,
    groupId: input.operationContext?.groupId,
    domainIds: input.operationContext?.domainIds ?? [],
  });
  const classificationDigest = opaqueDigest('admission-classification', {
    operation: input.operation,
    domainClass: input.domainClass,
    capturePolicy: input.capturePolicy,
    writeAdmissionMode: input.writeAdmissionMode,
  });
  const resultDigest = opaqueDigest('mutation-result', {
    changedCellCount: input.result.recalc?.changedCells?.length ?? 0,
    tableChangeCount: arrayLength(input.result.tableChanges),
    pivotChangeCount: arrayLength(input.result.pivotChanges),
    diagnosticCodes: input.diagnosticCodes,
  });

  return [
    {
      artifactId: 'operation-context',
      kind: 'operation-context',
      digest: operationDigest,
      redactionPolicy: input.redactionPolicy,
    },
    {
      artifactId: 'admission-classification',
      kind: 'admission-classification',
      digest: classificationDigest,
      redactionPolicy: input.redactionPolicy,
    },
    {
      artifactId: 'mutation-result',
      kind: 'mutation-result',
      digest: resultDigest,
      redactionPolicy: input.redactionPolicy,
    },
  ];
}

function opaqueDigest(kind: string, value: unknown) {
  return {
    algorithm: 'opaque' as const,
    value: `opaque:${kind}:${stableOpaqueHash(value)}`,
  };
}

function stableOpaqueHash(value: unknown): string {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}
