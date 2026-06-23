import type {
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionRecordRevision,
  VersionRefName,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import {
  VERSION_GRAPH_HEAD_REF,
  type VersionGraphRef,
  type VersionGraphSymbolicRef,
} from '../../document/version-store/graph-store';
import type { VersionStoreProvider } from '../../document/version-store/provider';
import type { VersionGraphStore } from '../../document/version-store/provider-graph-store';
import { validateRefName } from '../../document/version-store/ref-name';
import { namespaceForRegistry } from '../../document/version-store/registry';

export const VERSION_MAIN_REF = 'refs/heads/main' satisfies VersionMainRefName;
export const VERSION_BRANCH_REF_PREFIX = 'refs/heads/';

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

type AttachedVersionServices = {
  readonly provider?: unknown;
  readonly versionStoreProvider?: unknown;
  readonly storeProvider?: unknown;
};

export type ApplyMergeTargetRefCasValidationResult =
  | { readonly ok: true; readonly checked: boolean }
  | {
      readonly ok: false;
      readonly kind: 'staleTargetHead' | 'blocked';
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export type ApplyMergeTargetRefCasValidationInput = {
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead: VersionCommitExpectedHead;
};

export function mapPublicApplyTargetRef(
  value: unknown,
): VersionMainRefName | VersionRefName | undefined {
  if (typeof value !== 'string') return undefined;
  const branchName = value.startsWith(VERSION_BRANCH_REF_PREFIX)
    ? value.slice(VERSION_BRANCH_REF_PREFIX.length)
    : value;
  const parsed = validateRefName(branchName, 'targetRef');
  if (!parsed.ok) return undefined;
  const targetRef =
    parsed.name === 'main'
      ? VERSION_MAIN_REF
      : (`${VERSION_BRANCH_REF_PREFIX}${parsed.name}` as VersionRefName);
  return isApplyTargetRefName(targetRef) ? targetRef : undefined;
}

export function isApplyTargetRefName(value: VersionMainRefName | VersionRefName): boolean {
  return (
    value === VERSION_MAIN_REF ||
    value.startsWith(`${VERSION_BRANCH_REF_PREFIX}scenario/`) ||
    value.startsWith(`${VERSION_BRANCH_REF_PREFIX}agent/`)
  );
}

export async function validateApplyMergeTargetRefCasProof(
  ctx: DocumentContext,
  input: ApplyMergeTargetRefCasValidationInput,
): Promise<ApplyMergeTargetRefCasValidationResult> {
  const provider = getAttachedVersionStoreProvider(ctx);
  if (!provider) return { ok: true, checked: false };

  try {
    const expectedRevisionDiagnostics = expectedTargetHeadRevisionDiagnostics(input);
    if (expectedRevisionDiagnostics.length > 0) {
      return { ok: false, kind: 'blocked', diagnostics: expectedRevisionDiagnostics };
    }

    const registry = await provider.readGraphRegistry();
    if (registry.status !== 'ok') {
      return {
        ok: false,
        kind: 'blocked',
        diagnostics: mapProviderDiagnostics(registry.diagnostics),
      };
    }

    const graph = await provider.openGraph(
      namespaceForRegistry(registry.registry),
      provider.accessContext,
    );
    const target = await readTargetRef(graph, input.targetRef);
    if (!target.ok) return { ok: false, kind: 'blocked', diagnostics: target.diagnostics };

    const staleTarget = staleTargetHeadDiagnostics(target.ref, input);
    if (staleTarget.length > 0) {
      return { ok: false, kind: 'staleTargetHead', diagnostics: staleTarget };
    }

    if (shouldReadSymbolicHead(input)) {
      const symbolic = await readSymbolicHead(graph);
      if (!symbolic.ok) return { ok: false, kind: 'blocked', diagnostics: symbolic.diagnostics };

      const symbolicDiagnostics = symbolicHeadDiagnostics(symbolic.head, input);
      if (symbolicDiagnostics.length > 0) {
        return { ok: false, kind: 'blocked', diagnostics: symbolicDiagnostics };
      }
    }

    return { ok: true, checked: true };
  } catch {
    return { ok: false, kind: 'blocked', diagnostics: [providerErrorDiagnostic()] };
  }
}

async function readTargetRef(
  graph: VersionGraphStore,
  targetRef: VersionMainRefName | VersionRefName,
): Promise<
  | { readonly ok: true; readonly ref: VersionGraphRef }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  const read = await graph.readRef(targetRef);
  if (read.status !== 'success' || !read.ref) {
    return { ok: false, diagnostics: mapProviderDiagnostics(read.diagnostics) };
  }
  if (read.ref.name === VERSION_GRAPH_HEAD_REF) {
    return {
      ok: false,
      diagnostics: [
        refConflictDiagnostic(
          'The provider resolved applyMerge targetRef to a symbolic ref.',
          {
            reason: 'symbolicTargetRefResolved',
            expectedTargetRef: safePublicRefPayload(targetRef),
            actualTargetRef: redactedRefPayload(read.ref.name),
          },
          'no-write-attempted',
        ),
      ],
    };
  }
  if (read.ref.name !== targetRef) {
    return {
      ok: false,
      diagnostics: [
        refConflictDiagnostic(
          'The current target ref does not match applyMerge targetRef.',
          {
            reason: 'targetRefMismatch',
            expectedTargetRef: safePublicRefPayload(targetRef),
            actualTargetRef: safePublicRefPayload(read.ref.name),
          },
          'no-write-attempted',
        ),
      ],
    };
  }
  if (!isVersionRecordRevision(read.ref.revision)) {
    return {
      ok: false,
      diagnostics: [missingRefRevisionDiagnostic('missingTargetRefRevision', targetRef)],
    };
  }
  return { ok: true, ref: read.ref };
}

async function readSymbolicHead(
  graph: VersionGraphStore,
): Promise<
  | { readonly ok: true; readonly head: VersionGraphSymbolicRef }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  const read = await graph.readRef(VERSION_GRAPH_HEAD_REF);
  if (read.status !== 'success' || !read.ref) {
    return { ok: false, diagnostics: mapProviderDiagnostics(read.diagnostics) };
  }
  if (read.ref.name !== VERSION_GRAPH_HEAD_REF) {
    return {
      ok: false,
      diagnostics: [
        refConflictDiagnostic(
          'The provider did not resolve symbolic HEAD consistently.',
          {
            reason: 'symbolicHeadRefMismatch',
            expectedTargetRef: redactedRefPayload(VERSION_GRAPH_HEAD_REF),
            actualTargetRef: safePublicRefPayload(read.ref.name),
          },
          'no-write-attempted',
        ),
      ],
    };
  }
  if (!isVersionRecordRevision(read.ref.revision)) {
    return {
      ok: false,
      diagnostics: [missingRefRevisionDiagnostic('missingSymbolicHeadRevision')],
    };
  }
  return { ok: true, head: read.ref };
}

function shouldReadSymbolicHead(input: ApplyMergeTargetRefCasValidationInput): boolean {
  return (
    input.targetRef === VERSION_MAIN_REF ||
    input.expectedTargetHead.symbolicHeadRevision !== undefined
  );
}

function expectedTargetHeadRevisionDiagnostics(
  input: ApplyMergeTargetRefCasValidationInput,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  const expectedTargetHead = input.expectedTargetHead as unknown;
  if (!isRecord(expectedTargetHead)) {
    diagnostics.push(
      missingRefRevisionDiagnostic('missingExpectedTargetRefRevision', input.targetRef),
    );
    return diagnostics;
  }
  if (!isVersionRecordRevision(expectedTargetHead.revision)) {
    diagnostics.push(
      missingRefRevisionDiagnostic('missingExpectedTargetRefRevision', input.targetRef),
    );
  }
  const symbolicRevision = expectedTargetHead.symbolicHeadRevision;
  if (symbolicRevision !== undefined && !isVersionRecordRevision(symbolicRevision)) {
    diagnostics.push(missingRefRevisionDiagnostic('missingExpectedSymbolicHeadRevision'));
  }
  return diagnostics;
}

function staleTargetHeadDiagnostics(
  ref: VersionGraphRef,
  input: ApplyMergeTargetRefCasValidationInput,
): readonly VersionStoreDiagnostic[] {
  if (
    ref.commitId === input.expectedTargetHead.commitId &&
    revisionsEqual(ref.revision, input.expectedTargetHead.revision)
  ) {
    return [];
  }

  return [
    refConflictDiagnostic(
      'The target ref head no longer matches expectedTargetHead.',
      {
        reason: 'staleTargetHead',
        targetRef: safePublicRefPayload(input.targetRef),
        expectedHead: input.expectedTargetHead.commitId,
        actualHead: ref.commitId,
        expectedRevisionKind: input.expectedTargetHead.revision.kind,
        expectedRevision: input.expectedTargetHead.revision.value,
        actualRevisionKind: ref.revision.kind,
        actualRevision: ref.revision.value,
      },
      'ref-not-mutated',
    ),
  ];
}

function symbolicHeadDiagnostics(
  head: VersionGraphSymbolicRef,
  input: ApplyMergeTargetRefCasValidationInput,
): readonly VersionStoreDiagnostic[] {
  if (head.target !== input.targetRef) {
    return [
      refConflictDiagnostic(
        'The current symbolic HEAD target does not match applyMerge targetRef.',
        {
          reason: 'symbolicTargetMismatch',
          expectedTargetRef: safePublicRefPayload(input.targetRef),
          actualTargetRef: safePublicRefPayload(head.target),
        },
        'no-write-attempted',
      ),
    ];
  }

  const expectedRevision = input.expectedTargetHead.symbolicHeadRevision;
  if (expectedRevision && !revisionsEqual(head.revision, expectedRevision)) {
    return [
      refConflictDiagnostic(
        'The symbolic HEAD revision no longer matches expectedTargetHead.',
        {
          reason: 'staleSymbolicHead',
          targetRef: safePublicRefPayload(input.targetRef),
          expectedRevisionKind: expectedRevision.kind,
          expectedRevision: expectedRevision.value,
          actualRevisionKind: head.revision.kind,
          actualRevision: head.revision.value,
        },
        'no-write-attempted',
      ),
    ];
  }

  return [];
}

function getAttachedVersionStoreProvider(ctx: DocumentContext): VersionStoreProvider | null {
  const services = getAttachedVersionServices(ctx);
  if (!services) return null;

  for (const candidate of [
    services.provider,
    services.versionStoreProvider,
    services.storeProvider,
    services,
  ]) {
    if (hasVersionStoreProviderReads(candidate)) return candidate as VersionStoreProvider;
  }
  return null;
}

function getAttachedVersionServices(ctx: DocumentContext): AttachedVersionServices | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  return isRecord(services) ? services : null;
}

function hasVersionStoreProviderReads(value: unknown): value is VersionStoreProvider {
  return (
    isRecord(value) &&
    typeof value.readGraphRegistry === 'function' &&
    typeof value.openGraph === 'function'
  );
}

function mapProviderDiagnostics(
  diagnostics: readonly unknown[],
): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) return [providerErrorDiagnostic()];
  return diagnostics.map((diagnostic) => {
    if (!isRecord(diagnostic)) return providerErrorDiagnostic();
    return publicDiagnostic(
      safeProviderIssueCode(diagnostic.issueCode ?? diagnostic.code),
      'Version applyMerge target-ref CAS validation failed.',
      {
        recoverability: isRecoverability(diagnostic.recoverability)
          ? diagnostic.recoverability
          : 'retry',
        mutationGuarantee: 'no-write-attempted',
      },
    );
  });
}

function missingRefRevisionDiagnostic(
  reason:
    | 'missingExpectedTargetRefRevision'
    | 'missingExpectedSymbolicHeadRevision'
    | 'missingTargetRefRevision'
    | 'missingSymbolicHeadRevision',
  targetRef?: VersionMainRefName | VersionRefName,
): VersionStoreDiagnostic {
  const expectedProofMissing =
    reason === 'missingExpectedTargetRefRevision' ||
    reason === 'missingExpectedSymbolicHeadRevision';
  return publicDiagnostic(
    expectedProofMissing ? 'VERSION_INVALID_OPTIONS' : 'VERSION_PROVIDER_FAILED',
    safeMissingRevisionMessage(reason),
    {
      recoverability: expectedProofMissing ? 'none' : 'retry',
      payload: {
        reason,
        ...(targetRef ? { targetRef: safePublicRefPayload(targetRef) } : {}),
      },
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

function safeMissingRevisionMessage(
  reason:
    | 'missingExpectedTargetRefRevision'
    | 'missingExpectedSymbolicHeadRevision'
    | 'missingTargetRefRevision'
    | 'missingSymbolicHeadRevision',
): string {
  switch (reason) {
    case 'missingExpectedTargetRefRevision':
      return 'expectedTargetHead.revision is required for applyMerge CAS validation.';
    case 'missingExpectedSymbolicHeadRevision':
      return 'expectedTargetHead.symbolicHeadRevision is invalid for applyMerge CAS validation.';
    case 'missingTargetRefRevision':
      return 'The target ref revision is unavailable for applyMerge CAS validation.';
    case 'missingSymbolicHeadRevision':
      return 'The symbolic HEAD revision is unavailable for applyMerge CAS validation.';
  }
}

function refConflictDiagnostic(
  safeMessage: string,
  payload: VersionStoreDiagnostic['payload'],
  mutationGuarantee: NonNullable<VersionStoreDiagnostic['mutationGuarantee']>,
): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_REF_CONFLICT', safeMessage, {
    recoverability: 'retry',
    payload,
    mutationGuarantee,
  });
}

function providerErrorDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PROVIDER_FAILED',
    'Version applyMerge target-ref CAS validation failed.',
    { recoverability: 'retry', mutationGuarantee: 'no-write-attempted' },
  );
}

function publicDiagnostic(
  issueCode: string,
  safeMessage: string,
  options: {
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly payload?: VersionStoreDiagnostic['payload'];
    readonly mutationGuarantee?: VersionStoreDiagnostic['mutationGuarantee'];
  } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: 'error',
    recoverability: options.recoverability ?? 'none',
    messageTemplateId: `version.applyMerge.${issueCode}`,
    safeMessage,
    ...(options.payload ? { payload: { operation: 'applyMerge', ...options.payload } } : {}),
    redacted: true,
    mutationGuarantee: options.mutationGuarantee ?? 'no-write-attempted',
  };
}

function revisionsEqual(left: VersionRecordRevision, right: VersionRecordRevision): boolean {
  return left.kind === right.kind && left.value === right.value;
}

function safePublicRefPayload(value: unknown): string {
  return safePublicRefName(value) ?? 'redacted';
}

function redactedRefPayload(_value: unknown): string {
  return 'redacted';
}

function safePublicRefName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const mapped = mapPublicApplyTargetRef(value);
  return mapped === value ? mapped : null;
}

function isVersionRecordRevision(value: unknown): value is VersionRecordRevision {
  return (
    isRecord(value) &&
    (value.kind === 'counter' || value.kind === 'opaque') &&
    typeof value.value === 'string'
  );
}

function isRecoverability(value: unknown): value is VersionStoreDiagnostic['recoverability'] {
  return value === 'retry' || value === 'repair' || value === 'unsupported' || value === 'none';
}

function safeProviderIssueCode(value: unknown): string {
  return typeof value === 'string' && /^VERSION_[A-Z0-9_]+$/.test(value)
    ? value
    : 'VERSION_PROVIDER_FAILED';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
