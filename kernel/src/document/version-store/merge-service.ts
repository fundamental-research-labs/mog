import type {
  VersionDiffDisplay,
  VersionDiffDisplayValue,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionMergeChange,
  VersionMergeConflict,
  VersionMergeInput,
  VersionMergeOptions,
  VersionMergeResult,
  VersionRedactedValue,
  VersionSemanticValue,
  VersionStoreDiagnostic as PublicVersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { WorkbookCommit } from './commit-store';
import { VersionObjectStoreError } from './object-store';
import {
  VersionStoreProviderError,
  type VersionGraphStore,
  type VersionStoreDiagnostic,
  type VersionStoreProvider,
} from './provider';
import { namespaceForRegistry } from './registry';

const REDACTED_VALUE_REASONS = new Set([
  'permission-denied',
  'redaction-policy',
  'historical-acl-unavailable',
]);

const SUPPORTED_SEMANTIC_MERGE_DOMAINS = new Set([
  'cell',
  'cells.values',
  'sheet',
  'filters',
  'sorts',
  'named-ranges',
  'tables',
  'comments-notes',
  'conditional-formatting',
  'data-validation',
  'charts.source-range',
  'floating-objects.anchors',
]);

const SEMANTIC_MERGE_DOMAIN_ORDER = new Map(
  [...SUPPORTED_SEMANTIC_MERGE_DOMAINS].map((domain, index) => [domain, index]),
);

type MergeDiagnostic = PublicVersionStoreDiagnostic;

type ParsedSemanticChangeSet =
  | {
      readonly ok: true;
      readonly changes: readonly SemanticValueChange[];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly MergeDiagnostic[];
    };

type ParsedSemanticChange =
  | {
      readonly ok: true;
      readonly change: SemanticValueChange;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly MergeDiagnostic[];
    };

type SemanticValueChange = {
  readonly key: string;
  readonly structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>;
  readonly before: VersionDiffValue;
  readonly after: VersionDiffValue;
  readonly display?: VersionDiffDisplay;
};

export type WorkbookVersionMergeServiceOptions = {
  readonly provider: VersionStoreProvider;
};

export class WorkbookVersionMergeService {
  private readonly provider: VersionStoreProvider;

  constructor(options: WorkbookVersionMergeServiceOptions) {
    this.provider = options.provider;
  }

  async merge(
    input: VersionMergeInput,
    options: VersionMergeOptions = {},
  ): Promise<VersionMergeResult> {
    if (options.mode !== undefined && options.mode !== 'preview') {
      return blocked(input, [
        diagnostic('VERSION_INVALID_OPTIONS', 'merge supports only preview mode.', {
          payload: { option: 'mode' },
        }),
      ]);
    }

    const opened = await this.openVisibleGraph();
    if (!opened.ok) return blocked(input, opened.diagnostics);

    const ours = await readDirectChild(opened.graph, input.base, input.ours, 'ours');
    if (!ours.ok) return blocked(input, ours.diagnostics);
    const theirs = await readDirectChild(opened.graph, input.base, input.theirs, 'theirs');
    if (!theirs.ok) return blocked(input, theirs.diagnostics);

    const oursPayload = await readSemanticChangeSet(opened.graph, ours.commit);
    if (!oursPayload.ok) return blocked(input, oursPayload.diagnostics);
    const theirsPayload = await readSemanticChangeSet(opened.graph, theirs.commit);
    if (!theirsPayload.ok) return blocked(input, theirsPayload.diagnostics);

    const oursChanges = parseSemanticChangeSet(oursPayload.payload, 'ours');
    if (!oursChanges.ok) return blocked(input, oursChanges.diagnostics);
    const theirsChanges = parseSemanticChangeSet(theirsPayload.payload, 'theirs');
    if (!theirsChanges.ok) return blocked(input, theirsChanges.diagnostics);

    let classified: Awaited<ReturnType<typeof classifyValueChanges>>;
    try {
      classified = await classifyValueChanges(oursChanges.changes, theirsChanges.changes);
    } catch {
      return blocked(input, [
        diagnostic(
          'VERSION_PROVIDER_ERROR',
          'Merge preview failed before producing stable public conflict evidence.',
          {
            severity: 'fatal',
            recoverability: 'retry',
          },
        ),
      ]);
    }
    if (!classified.ok) return blocked(input, classified.diagnostics);

    if (classified.conflicts.length > 0) {
      return {
        status: 'conflicted',
        base: input.base,
        ours: input.ours,
        theirs: input.theirs,
        changes: classified.changes,
        conflicts: classified.conflicts,
        diagnostics: [],
        mutationGuarantee: 'preview-only',
      };
    }

    return {
      status: 'clean',
      base: input.base,
      ours: input.ours,
      theirs: input.theirs,
      changes: classified.changes,
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    };
  }

  private async openVisibleGraph(): Promise<
    | {
        readonly ok: true;
        readonly graph: VersionGraphStore;
      }
    | {
        readonly ok: false;
        readonly diagnostics: readonly MergeDiagnostic[];
      }
  > {
    try {
      const registryRead = await this.provider.readGraphRegistry();
      if (registryRead.status !== 'ok') {
        return { ok: false, diagnostics: graphDiagnostics(registryRead.diagnostics) };
      }

      const graph = await this.provider.openGraph(
        namespaceForRegistry(registryRead.registry),
        this.provider.accessContext,
      );
      return { ok: true, graph };
    } catch (error) {
      if (error instanceof VersionStoreProviderError) {
        return { ok: false, diagnostics: graphDiagnostics(error.diagnostics) };
      }
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            'VERSION_PROVIDER_ERROR',
            'Version store provider failed before returning graph state.',
            {
              severity: 'fatal',
              recoverability: 'retry',
            },
          ),
        ],
      };
    }
  }
}

export function createWorkbookVersionMergeService(
  options: WorkbookVersionMergeServiceOptions,
): WorkbookVersionMergeService {
  return new WorkbookVersionMergeService(options);
}

async function readDirectChild(
  graph: VersionGraphStore,
  baseCommitId: WorkbookCommitId,
  commitId: WorkbookCommitId,
  branch: 'ours' | 'theirs',
): Promise<
  | { readonly ok: true; readonly commit: WorkbookCommit }
  | { readonly ok: false; readonly diagnostics: readonly MergeDiagnostic[] }
> {
  const closure = await graph.readCommitClosure(commitId);
  if (closure.status !== 'success') {
    return { ok: false, diagnostics: graphDiagnostics(closure.diagnostics, { branch }) };
  }

  const commit = closure.commits.find((candidate) => candidate.id === commitId);
  if (!commit) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'VERSION_UNMATERIALIZABLE_COMMIT',
          'Merge commit is absent from its readable commit closure.',
          { payload: { branch } },
        ),
      ],
    };
  }

  if (
    commit.payload.parentCommitIds.length !== 1 ||
    commit.payload.parentCommitIds[0] !== baseCommitId
  ) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'VERSION_MERGE_UNSUPPORTED_ANCESTRY',
          'Merge preview requires ours and theirs to be direct children of base.',
          {
            payload: {
              branch,
              parentCount: commit.payload.parentCommitIds.length,
              parentMatchesBase: commit.payload.parentCommitIds[0] === baseCommitId,
            },
          },
        ),
      ],
    };
  }

  if (!closure.commits.some((candidate) => candidate.id === baseCommitId)) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'VERSION_MISSING_PARENT',
          'Merge base commit is not readable from the child commit closure.',
          { recoverability: 'repair', payload: { branch } },
        ),
      ],
    };
  }

  return { ok: true, commit };
}

async function readSemanticChangeSet(
  graph: VersionGraphStore,
  commit: WorkbookCommit,
): Promise<
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly diagnostics: readonly MergeDiagnostic[] }
> {
  try {
    const record = await graph.getObjectRecord<unknown>({
      kind: 'object',
      objectType: 'workbook.semanticChangeSet.v1',
      digest: commit.payload.semanticChangeSetDigest,
    });
    return { ok: true, payload: record.preimage.payload };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          error instanceof VersionObjectStoreError &&
            error.diagnostic.code === 'VERSION_OBJECT_NOT_FOUND'
            ? 'VERSION_MISSING_OBJECT'
            : 'VERSION_PROVIDER_ERROR',
          'Merge preview semantic change-set object could not be read.',
          {
            recoverability: error instanceof VersionObjectStoreError ? 'repair' : 'retry',
          },
        ),
      ],
    };
  }
}

function parseSemanticChangeSet(payload: unknown, branch: 'ours' | 'theirs'): ParsedSemanticChangeSet {
  if (!isRecord(payload) || payload.schemaVersion !== 1 || !Array.isArray(payload.changes)) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'VERSION_UNSUPPORTED_SCHEMA',
          'Semantic change-set payload is not supported by merge preview.',
          { payload: { branch } },
        ),
      ],
    };
  }

  const changes: SemanticValueChange[] = [];
  const seenKeys = new Set<string>();
  for (let index = 0; index < payload.changes.length; index++) {
    const parsed = parseSemanticChange(payload.changes[index], branch, index);
    if (!parsed.ok) return parsed;
    if (seenKeys.has(parsed.change.key)) {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            'VERSION_UNSUPPORTED_SCHEMA',
            'Merge preview cannot classify duplicate value changes for the same property.',
            { payload: { branch, itemIndex: index } },
          ),
        ],
      };
    }
    seenKeys.add(parsed.change.key);
    changes.push(parsed.change);
  }

  return { ok: true, changes };
}

function parseSemanticChange(
  value: unknown,
  branch: 'ours' | 'theirs',
  itemIndex: number,
): ParsedSemanticChange {
  if (!isRecord(value)) {
    return unsupportedChange(branch, itemIndex);
  }
  if (
    hasRedactedValue(value.structural) ||
    hasRedactedValue(value.before) ||
    hasRedactedValue(value.after)
  ) {
    return redactedChange(branch, itemIndex);
  }

  const structural = mapStructuralMetadata(value);
  if (!structural) return unsupportedChange(branch, itemIndex);
  if (structural.domain !== 'cells.values' && structural.propertyPath.length === 0) {
    return unsupportedChange(branch, itemIndex);
  }
  if (!isSupportedSemanticValueChange(structural)) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'VERSION_MERGE_UNSUPPORTED_DOMAIN',
          'Merge preview supports only allowlisted semantic value changes.',
          {
            payload: {
              branch,
              itemIndex,
              domain: structural.domain,
              propertyPath: structural.propertyPath.join('.'),
            },
          },
        ),
      ],
    };
  }

  const before = mapDiffValue(value.before);
  const after = mapDiffValue(value.after);
  if (!before || !after) return unsupportedChange(branch, itemIndex);

  const display = value.display === undefined ? undefined : mapDiffDisplay(value.display);
  if (value.display !== undefined && !display) {
    return hasRedactedDisplay(value.display)
      ? redactedChange(branch, itemIndex)
      : unsupportedChange(branch, itemIndex);
  }

  return {
    ok: true,
    change: {
      key: mergePropertyKey(structural),
      structural,
      before,
      after,
      ...(display ? { display } : {}),
    },
  };
}

async function classifyValueChanges(
  ours: readonly SemanticValueChange[],
  theirs: readonly SemanticValueChange[],
): Promise<
  | {
      readonly ok: true;
      readonly changes: readonly VersionMergeChange[];
      readonly conflicts: readonly VersionMergeConflict[];
    }
  | { readonly ok: false; readonly diagnostics: readonly MergeDiagnostic[] }
> {
  const changes: VersionMergeChange[] = [];
  const conflicts: VersionMergeConflict[] = [];
  const oursByKey = new Map(ours.map((change) => [change.key, change]));
  const consumedTheirs = new Set<string>();

  for (const oursChange of ours) {
    const theirsChange = theirs.find((candidate) => candidate.key === oursChange.key);
    if (!theirsChange) {
      changes.push({
        structural: oursChange.structural,
        base: oursChange.before,
        ours: oursChange.after,
        merged: oursChange.after,
        ...(oursChange.display ? { display: oursChange.display } : {}),
      });
      continue;
    }

    consumedTheirs.add(theirsChange.key);
    if (!semanticValuesEqual(oursChange.before, theirsChange.before)) {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            'VERSION_INVALID_COMMIT_PAYLOAD',
            'Merge preview found inconsistent base values for the same property.',
            { recoverability: 'repair' },
          ),
        ],
      };
    }

    const display = oursChange.display ?? theirsChange.display;
    if (semanticValuesEqual(oursChange.after, theirsChange.after)) {
      changes.push({
        structural: await mergeStableStructuralMetadata(oursChange, theirsChange, 'clean'),
        base: oursChange.before,
        ours: oursChange.after,
        theirs: theirsChange.after,
        merged: oursChange.after,
        ...(display ? { display } : {}),
      });
      continue;
    }

    const structural = await mergeStableStructuralMetadata(oursChange, theirsChange, 'conflict');
    const identity = await stableMergeConflictIdentity(
      structural,
      oursChange.before,
      oursChange.after,
      theirsChange.after,
    );
    conflicts.push({
      conflictId: identity.conflictId,
      conflictDigest: identity.conflictDigest,
      conflictKind: 'same-property',
      structural,
      base: oursChange.before,
      ours: oursChange.after,
      theirs: theirsChange.after,
      ...(display ? { display } : {}),
    });
  }

  for (const theirsChange of theirs) {
    if (oursByKey.has(theirsChange.key) || consumedTheirs.has(theirsChange.key)) continue;
    changes.push({
      structural: theirsChange.structural,
      base: theirsChange.before,
      theirs: theirsChange.after,
      merged: theirsChange.after,
      ...(theirsChange.display ? { display: theirsChange.display } : {}),
    });
  }

  changes.sort(compareMergeChanges);
  conflicts.sort(compareMergeConflicts);

  return { ok: true, changes, conflicts };
}

function isSupportedSemanticValueChange(
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
): boolean {
  if (!SUPPORTED_SEMANTIC_MERGE_DOMAINS.has(structural.domain)) return false;

  if (structural.domain === 'cell') {
    return structural.propertyPath.length === 1 && structural.propertyPath[0] === 'value';
  }

  if (structural.domain === 'cells.values') {
    return (
      structural.propertyPath.length === 0 ||
      (structural.propertyPath.length === 1 && structural.propertyPath[0] === 'value')
    );
  }

  return structural.propertyPath.length > 0;
}

function mergePropertyKey(
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
): string {
  if (
    structural.domain === 'cell' ||
    (structural.domain === 'cells.values' &&
      (structural.propertyPath.length === 0 ||
        (structural.propertyPath.length === 1 && structural.propertyPath[0] === 'value')))
  ) {
    return JSON.stringify(['cells.values', structural.entityId, 'value']);
  }

  return JSON.stringify([structural.domain, structural.entityId, structural.propertyPath]);
}

async function mergeStableStructuralMetadata(
  oursChange: SemanticValueChange,
  theirsChange: SemanticValueChange,
  status: 'clean' | 'conflict',
): Promise<Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>> {
  const structural = normalizeMergeStructuralMetadata(oursChange.structural);
  const changeId = await stableMergeChangeId(
    status,
    structural,
    oursChange.before,
    semanticValuesEqual(oursChange.after, theirsChange.after)
      ? [oursChange.after]
      : [oursChange.after, theirsChange.after].sort(compareDiffValues),
  );

  return {
    ...structural,
    changeId,
  };
}

function normalizeMergeStructuralMetadata(
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
): Exclude<VersionDiffStructuralMetadata, VersionRedactedValue> {
  if (
    structural.domain === 'cell' ||
    (structural.domain === 'cells.values' &&
      (structural.propertyPath.length === 0 ||
        (structural.propertyPath.length === 1 && structural.propertyPath[0] === 'value')))
  ) {
    return {
      kind: 'metadata',
      changeId: structural.changeId,
      domain: 'cells.values',
      entityId: structural.entityId,
      propertyPath: ['value'],
    };
  }

  return {
    kind: 'metadata',
    changeId: structural.changeId,
    domain: structural.domain,
    entityId: structural.entityId,
    propertyPath: [...structural.propertyPath],
  };
}

async function stableMergeChangeId(
  status: 'clean' | 'conflict',
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
  base: VersionDiffValue,
  afterValues: readonly VersionDiffValue[],
): Promise<string> {
  const canonical = JSON.stringify({
    schemaVersion: 1,
    status,
    key: mergePropertyKey(structural),
    base,
    afterValues,
  });

  const digest = await sha256Hex(`mog.version.merge.change-id.v1\n${canonical}`);
  return `merge-${status}:sha256:${digest}`;
}

async function stableMergeConflictIdentity(
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
  base: VersionDiffValue,
  ours: VersionDiffValue,
  theirs: VersionDiffValue,
): Promise<{ readonly conflictId: string; readonly conflictDigest: string }> {
  const sideValues = [ours, theirs].sort(compareDiffValues);
  const canonical = JSON.stringify({
    schemaVersion: 1,
    conflictKind: 'same-property',
    key: mergePropertyKey(structural),
    base,
    sideValues,
  });
  const conflictIdDigest = await sha256Hex(`mog.version.merge.conflict-id.v1\n${canonical}`);
  const conflictDigest = await sha256Hex(`mog.version.merge.conflict-digest.v1\n${canonical}`);

  return {
    conflictId: `conflict:sha256:${conflictIdDigest}`,
    conflictDigest: `sha256:${conflictDigest}`,
  };
}

function compareMergeChanges(left: VersionMergeChange, right: VersionMergeChange): number {
  return compareStructuralMetadata(left.structural, right.structural);
}

function compareMergeConflicts(left: VersionMergeConflict, right: VersionMergeConflict): number {
  return compareStructuralMetadata(left.structural, right.structural);
}

function compareStructuralMetadata(
  left: VersionDiffStructuralMetadata,
  right: VersionDiffStructuralMetadata,
): number {
  if (hasRedactedValue(left) || hasRedactedValue(right)) return 0;
  return compareStrings(structuralSortKey(left), structuralSortKey(right));
}

function structuralSortKey(
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
): string {
  const normalized = normalizeMergeStructuralMetadata(structural);
  const rank = SEMANTIC_MERGE_DOMAIN_ORDER.get(normalized.domain) ?? Number.MAX_SAFE_INTEGER;
  return [
    rank.toString().padStart(4, '0'),
    normalized.domain,
    normalized.entityId,
    ...normalized.propertyPath,
  ].join('\u0000');
}

function compareDiffValues(left: VersionDiffValue, right: VersionDiffValue): number {
  return compareStrings(JSON.stringify(left), JSON.stringify(right));
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    throw new Error('WorkbookVersionMergeService requires SHA-256 support');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function mapStructuralMetadata(
  value: Readonly<Record<string, unknown>>,
): Exclude<VersionDiffStructuralMetadata, VersionRedactedValue> | null {
  const source = isRecord(value.structural) ? value.structural : value;
  if (hasRedactedValue(source)) return null;

  if (
    typeof source.changeId !== 'string' ||
    typeof source.domain !== 'string' ||
    source.domain.trim().length === 0 ||
    typeof source.entityId !== 'string' ||
    source.entityId.trim().length === 0 ||
    !Array.isArray(source.propertyPath) ||
    !source.propertyPath.every(
      (segment) => typeof segment === 'string' && segment.trim().length > 0,
    )
  ) {
    return null;
  }

  return {
    kind: 'metadata',
    changeId: source.changeId,
    domain: source.domain,
    entityId: source.entityId,
    propertyPath: [...source.propertyPath],
  };
}

function mapDiffValue(value: unknown): VersionDiffValue | null {
  if (hasRedactedValue(value)) return null;
  if (!isRecord(value) || value.kind !== 'value') return null;

  const semanticValue = mapSemanticValue(value.value);
  if (semanticValue === undefined) return null;
  return { kind: 'value', value: semanticValue };
}

function mapDiffDisplay(value: unknown): VersionDiffDisplay | null {
  if (!isRecord(value) || hasRedactedDisplay(value)) return null;

  const display: {
    sheetName?: VersionDiffDisplayValue;
    address?: VersionDiffDisplayValue;
    entityLabel?: VersionDiffDisplayValue;
  } = {};

  for (const key of ['sheetName', 'address', 'entityLabel'] as const) {
    if (value[key] === undefined) continue;
    const displayValue = mapDiffDisplayValue(value[key]);
    if (!displayValue) return null;
    display[key] = displayValue;
  }
  return display;
}

function mapDiffDisplayValue(value: unknown): VersionDiffDisplayValue | null {
  if (hasRedactedValue(value)) return null;
  if (!isRecord(value) || value.kind !== 'value' || typeof value.value !== 'string') return null;
  return { kind: 'value', value: value.value };
}

function hasRedactedDisplay(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ['sheetName', 'address', 'entityLabel'].some((key) => hasRedactedValue(value[key]));
}

function hasRedactedValue(value: unknown): value is VersionRedactedValue {
  return (
    isRecord(value) &&
    value.kind === 'redacted' &&
    typeof value.reason === 'string' &&
    REDACTED_VALUE_REASONS.has(value.reason)
  );
}

function mapSemanticValue(value: unknown, depth = 0): VersionSemanticValue | undefined {
  if (depth > 16) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (!isRecord(value)) return undefined;

  switch (value.kind) {
    case 'blank':
      return { kind: 'blank' };
    case 'dateTime':
      return typeof value.iso === 'string' ? { kind: 'dateTime', iso: value.iso } : undefined;
    case 'duration':
      return typeof value.iso === 'string' ? { kind: 'duration', iso: value.iso } : undefined;
    case 'error':
      if (typeof value.code !== 'string') return undefined;
      return {
        kind: 'error',
        code: value.code,
        ...(typeof value.message === 'string' ? { message: value.message } : {}),
      };
    case 'formula': {
      if (typeof value.formula !== 'string') return undefined;
      if (!('result' in value)) return { kind: 'formula', formula: value.formula };
      const result = mapSemanticValue(value.result, depth + 1);
      return result === undefined ? undefined : { kind: 'formula', formula: value.formula, result };
    }
    case 'array': {
      if (!Array.isArray(value.values)) return undefined;
      const values = mapSemanticValues(value.values, depth + 1);
      return values ? { kind: 'array', values } : undefined;
    }
    case 'richText': {
      if (!Array.isArray(value.runs)) return undefined;
      const runs = value.runs.map((run) => {
        if (!isRecord(run) || typeof run.text !== 'string') return null;
        return {
          text: run.text,
          ...(typeof run.styleRef === 'string' ? { styleRef: run.styleRef } : {}),
        };
      });
      if (runs.some((run) => run === null)) return undefined;
      return {
        kind: 'richText',
        runs: runs as { readonly text: string; readonly styleRef?: string }[],
      };
    }
    case 'object': {
      if (!Array.isArray(value.fields)) return undefined;
      const fields = value.fields.map((field) => {
        if (!isRecord(field) || typeof field.key !== 'string') return null;
        const mappedValue = mapSemanticValue(field.value, depth + 1);
        return mappedValue === undefined ? null : { key: field.key, value: mappedValue };
      });
      if (fields.some((field) => field === null)) return undefined;
      return {
        kind: 'object',
        fields: fields as { readonly key: string; readonly value: VersionSemanticValue }[],
      };
    }
    default:
      return undefined;
  }
}

function mapSemanticValues(
  values: readonly unknown[],
  depth: number,
): readonly VersionSemanticValue[] | undefined {
  const mapped = values.map((value) => mapSemanticValue(value, depth));
  return mapped.some((value) => value === undefined)
    ? undefined
    : (mapped as readonly VersionSemanticValue[]);
}

function semanticValuesEqual(left: VersionDiffValue, right: VersionDiffValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function unsupportedChange(branch: 'ours' | 'theirs', itemIndex: number): ParsedSemanticChange {
  return {
    ok: false,
    diagnostics: [
      diagnostic(
        'VERSION_UNSUPPORTED_SCHEMA',
        'Semantic change record is not supported by merge preview.',
        { payload: { branch, itemIndex } },
      ),
    ],
  };
}

function redactedChange(branch: 'ours' | 'theirs', itemIndex: number): ParsedSemanticChange {
  return {
    ok: false,
    diagnostics: [
      diagnostic(
        'VERSION_REDACTION_VIOLATION',
        'Merge preview cannot classify redacted semantic change records.',
        { recoverability: 'unsupported', payload: { branch, itemIndex } },
      ),
    ],
  };
}

function blocked(
  input: VersionMergeInput,
  diagnostics: readonly MergeDiagnostic[],
): VersionMergeResult {
  return {
    status: 'blocked',
    base: input.base,
    ours: input.ours,
    theirs: input.theirs,
    changes: [],
    conflicts: [],
    diagnostics,
    mutationGuarantee: 'preview-only',
  };
}

function graphDiagnostics(
  diagnostics: readonly unknown[],
  payload: Readonly<Record<string, string | number | boolean | null>> = {},
): readonly MergeDiagnostic[] {
  if (diagnostics.length === 0) {
    return [
      diagnostic(
        'VERSION_GRAPH_UNINITIALIZED',
        'The workbook version graph is not initialized for this document.',
        { recoverability: 'unsupported', payload },
      ),
    ];
  }
  return diagnostics.map((item) => {
    if (!isRecord(item)) {
      return diagnostic('VERSION_PROVIDER_ERROR', 'Version graph read failed.', {
        severity: 'fatal',
        recoverability: 'retry',
        payload,
      });
    }
    const issueCode = item.issueCode ?? item.code ?? 'VERSION_PROVIDER_ERROR';
    const severity = item.severity;
    return diagnostic(
      typeof issueCode === 'string' ? issueCode : 'VERSION_PROVIDER_ERROR',
      typeof item.safeMessage === 'string'
        ? item.safeMessage
        : typeof item.message === 'string'
          ? item.message
          : 'Version graph read failed.',
      {
        severity: severity === 'fatal' ? 'fatal' : severity === 'warning' ? 'warning' : 'error',
        recoverability: recoverabilityForIssue(
          typeof issueCode === 'string' ? issueCode : 'VERSION_PROVIDER_ERROR',
        ),
        payload,
      },
    );
  });
}

function diagnostic(
  issueCode: string,
  safeMessage: string,
  options: {
    readonly severity?: MergeDiagnostic['severity'];
    readonly recoverability?: MergeDiagnostic['recoverability'];
    readonly payload?: Readonly<Record<string, string | number | boolean | null>>;
  } = {},
): MergeDiagnostic {
  return {
    issueCode,
    severity: options.severity ?? (issueCode === 'VERSION_PROVIDER_ERROR' ? 'fatal' : 'error'),
    recoverability: options.recoverability ?? recoverabilityForIssue(issueCode),
    messageTemplateId: `version.merge.${issueCode}` as MergeDiagnostic['messageTemplateId'],
    safeMessage,
    ...(options.payload ? { payload: { operation: 'merge', ...options.payload } } : {}),
    redacted: true,
  };
}

function recoverabilityForIssue(issueCode: string): MergeDiagnostic['recoverability'] {
  switch (issueCode) {
    case 'VERSION_PROVIDER_ERROR':
    case 'VERSION_REF_CONFLICT':
    case 'VERSION_STALE_PAGE_CURSOR':
      return 'retry';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_INVALID_COMMIT_PAYLOAD':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_MISSING_PARENT':
    case 'VERSION_OBJECT_STORE_FAILURE':
      return 'repair';
    case 'VERSION_GRAPH_UNINITIALIZED':
    case 'VERSION_MERGE_UNSUPPORTED_ANCESTRY':
    case 'VERSION_MERGE_UNSUPPORTED_DOMAIN':
    case 'VERSION_PERMISSION_DENIED':
    case 'VERSION_REDACTION_VIOLATION':
    case 'VERSION_UNMATERIALIZABLE_COMMIT':
    case 'VERSION_UNSUPPORTED_SCHEMA':
      return 'unsupported';
    default:
      return 'none';
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
