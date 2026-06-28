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
  const operationDigest = sourceArtifactDigest('operation-context', {
    operation: input.operation,
    operationId: input.operationId,
    groupId: input.operationContext?.groupId,
    domainIds: input.operationContext?.domainIds ?? [],
  });
  const classificationDigest = sourceArtifactDigest('admission-classification', {
    operation: input.operation,
    domainClass: input.domainClass,
    capturePolicy: input.capturePolicy,
    writeAdmissionMode: input.writeAdmissionMode,
  });
  const resultDigest = sourceArtifactDigest('mutation-result', {
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

function sourceArtifactDigest(kind: string, value: unknown) {
  return {
    algorithm: 'sha256' as const,
    digest: sha256Hex(`${kind}\n${stableStringify(value)}`),
  };
}

function utf8Bytes(input: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    let codePoint = input.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < input.length) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      }
    }

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
  0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
  0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
  0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Hex(input: string): string {
  const bytes = utf8Bytes(input);
  const bitLength = bytes.length * 8;
  const paddedLength = ((bytes.length + 9 + 63) >>> 6) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 =
        rotateRight(words[index - 15], 7) ^
        rotateRight(words[index - 15], 18) ^
        (words[index - 15] >>> 3);
      const s1 =
        rotateRight(words[index - 2], 17) ^
        rotateRight(words[index - 2], 19) ^
        (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[index] + words[index]) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
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
