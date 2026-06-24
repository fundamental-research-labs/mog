import type {
  VersionCommitExpectedHead,
  VersionRecordRevision,
  VersionRevertInput,
  VersionRevertOptions,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import {
  mapCommitId,
  mapPublicExpectedTargetHead,
  mapPublicRevision,
  mapPublicTargetRef,
} from '../../version-attempt-metadata';
import { providerErrorDiagnostic } from './version-revert-provider';
import {
  invalidOptionDiagnostic,
  revertDiagnostic,
  VERSION_REVERT_CAS_UNAVAILABLE_DIAGNOSTIC_CODE,
  VERSION_REVERT_STALE_HEAD_DIAGNOSTIC_CODE,
} from './version-revert-diagnostics';

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

type AttachedVersionReadRefService = {
  readonly readRef: (name: string) => MaybePromise<unknown>;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

type AttachedVersionServices = {
  readonly publicService?: unknown;
  readonly writeService?: unknown;
  readonly commitService?: unknown;
  readonly readService?: unknown;
  readonly refService?: unknown;
};

export type RevertTargetRefCasResult =
  | { readonly ok: true; readonly checked: boolean }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export type RevertTargetRefPreconditionResult =
  | { readonly ok: true; readonly input: VersionRevertInput }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export async function prepareRevertTargetRefPreconditions(
  ctx: DocumentContext,
  input: VersionRevertInput,
  options: VersionRevertOptions,
): Promise<RevertTargetRefPreconditionResult> {
  if (!input.targetRef) return { ok: true, input };

  const targetRef = mapPublicTargetRef(input.targetRef);
  if (!targetRef) {
    return {
      ok: false,
      diagnostics: [
        invalidOptionDiagnostic('targetRef', 'targetRef must name a public-safe version branch.'),
      ],
    };
  }

  const normalizedInput = input.targetRef === targetRef ? input : { ...input, targetRef };
  if (normalizedInput.expectedTargetHead || options.dryRun === true) {
    return { ok: true, input: normalizedInput };
  }

  const readService = getAttachedReadRefService(ctx);
  if (!readService) {
    return {
      ok: false,
      diagnostics: [targetRefCasUnavailableDiagnostic(targetRef)],
    };
  }

  try {
    const read = await readService.readRef(targetRef);
    const current = mapReadRefResult(read);
    if (!current) {
      return { ok: false, diagnostics: [providerErrorDiagnostic()] };
    }

    return {
      ok: true,
      input: {
        ...normalizedInput,
        expectedTargetHead: expectedHeadFromReadRef(current),
      },
    };
  } catch {
    return { ok: false, diagnostics: [providerErrorDiagnostic()] };
  }
}

export async function validateRevertTargetRefCas(
  ctx: DocumentContext,
  input: VersionRevertInput,
): Promise<RevertTargetRefCasResult> {
  if (!input.targetRef || !input.expectedTargetHead) return { ok: true, checked: false };

  const targetRef = mapPublicTargetRef(input.targetRef);
  const expectedTargetHead = mapPublicExpectedTargetHead(input.expectedTargetHead);
  if (!targetRef || !expectedTargetHead) {
    return {
      ok: false,
      diagnostics: [
        invalidOptionDiagnostic(
          !targetRef ? 'targetRef' : 'expectedTargetHead',
          !targetRef
            ? 'targetRef must name a public-safe version branch.'
            : 'expectedTargetHead must be a valid expected head record.',
        ),
      ],
    };
  }

  const readService = getAttachedReadRefService(ctx);
  if (!readService) return { ok: true, checked: false };

  try {
    const read = await readService.readRef(targetRef);
    const current = mapReadRefResult(read);
    if (!current) {
      return { ok: false, diagnostics: [providerErrorDiagnostic()] };
    }

    if (
      current.commitId === expectedTargetHead.commitId &&
      revisionsEqual(current.revision, expectedTargetHead.revision)
    ) {
      return { ok: true, checked: true };
    }

    return {
      ok: false,
      diagnostics: [
        revertDiagnostic(
          VERSION_REVERT_STALE_HEAD_DIAGNOSTIC_CODE,
          'Version-control revert is rejected because the target head is stale or cannot be proven current.',
          {
            reason: 'staleTargetHead',
            refName: targetRef,
            expectedCommitId: expectedTargetHead.commitId,
            actualCommitId: current.commitId,
            expectedRevisionKind: expectedTargetHead.revision.kind,
            expectedRevision: expectedTargetHead.revision.value,
            actualRevisionKind: current.revision.kind,
            actualRevision: current.revision.value,
          },
          'retry',
          'ref-not-mutated',
        ),
      ],
    };
  } catch {
    return { ok: false, diagnostics: [providerErrorDiagnostic()] };
  }
}

function expectedHeadFromReadRef(input: {
  readonly commitId: WorkbookCommitId;
  readonly revision: VersionRecordRevision;
}): VersionCommitExpectedHead {
  return {
    commitId: input.commitId,
    revision: input.revision,
  };
}

function targetRefCasUnavailableDiagnostic(targetRef: string): VersionStoreDiagnostic {
  return revertDiagnostic(
    VERSION_REVERT_CAS_UNAVAILABLE_DIAGNOSTIC_CODE,
    'Version-control revert is rejected because required CAS preconditions cannot be proven.',
    {
      refName: targetRef,
      reason: 'target-ref-cas',
      expectedHeadProvided: false,
    },
    'retry',
    'no-write-attempted',
  );
}

function getAttachedReadRefService(ctx: DocumentContext): AttachedVersionReadRefService | null {
  const services = getAttachedVersionServices(ctx);
  if (!services) return null;

  for (const candidate of [
    services.readService,
    services.publicService,
    services.writeService,
    services.commitService,
    services.refService,
    services,
  ]) {
    const readRef = bindMethod(candidate, 'readRef');
    if (readRef) return { readRef: (name) => readRef(name) };
  }

  return null;
}

function getAttachedVersionServices(ctx: DocumentContext): AttachedVersionServices | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  return isRecord(services) ? services : null;
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function mapReadRefResult(
  value: unknown,
): { readonly commitId: WorkbookCommitId; readonly revision: VersionRecordRevision } | null {
  const ref = unwrapRecordPayload(value, 'ref') ?? unwrapRecordPayload(value, 'value') ?? value;
  if (!isRecord(ref)) return null;
  const commitId = mapCommitId(ref.commitId ?? ref.id ?? ref.targetCommitId);
  const revision = mapPublicRevision(ref.revision ?? ref.refRevision);
  return commitId && revision ? { commitId, revision } : null;
}

function unwrapRecordPayload(
  value: unknown,
  key: string,
): Readonly<Record<string, unknown>> | null {
  return isRecord(value) && isRecord(value[key]) ? value[key] : null;
}

function revisionsEqual(left: VersionRecordRevision, right: VersionRecordRevision): boolean {
  return left.kind === right.kind && left.value === right.value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
