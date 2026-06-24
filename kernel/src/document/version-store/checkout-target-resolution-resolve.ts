import type { WorkbookCommitId } from './object-digest';
import type { RefName } from './refs/ref-name';
import type { RefVersion, GetRefResult } from './refs/ref-store';
import type {
  CheckoutHeadReader,
  CheckoutHeadReadResult,
  CheckoutMaterializationDiagnostic,
  CheckoutMaterializationErrorCode,
  CheckoutRefReader,
  CheckoutResolvedMaterializationTarget,
} from './checkout-service';
import {
  checkoutAccessDeniedDiagnosticFromSources,
  checkoutDiagnostic as diagnostic,
  checkoutFailure as failure,
  errorName,
  freezeCheckoutDiagnostics as freezeDiagnostics,
} from './checkout-service-diagnostics';
import {
  parseCommitIdForTarget,
  parseOptionalCommitId,
  parseRefNameForTarget,
} from './checkout-target-resolution-parse';
import type {
  CheckoutTargetResolutionReaders,
  ParsedCheckoutRequest,
  ResolvedTargetResult,
} from './checkout-target-resolution-types';

export async function resolveCheckoutTarget(
  parsed: Extract<ParsedCheckoutRequest, { ok: true }>,
  readers: CheckoutTargetResolutionReaders,
): Promise<ResolvedTargetResult> {
  if (parsed.target === 'commit') {
    return {
      ok: true,
      target: Object.freeze({ kind: 'commit', commitId: parsed.commitId }),
      commitId: parsed.commitId,
      diagnostics: [],
    };
  }

  if (parsed.target === 'head') {
    return resolveHead(readers.headReader);
  }

  return resolveRef(parsed.refName, readers.refReader);
}

async function resolveHead(
  headReader: CheckoutHeadReader | undefined,
): Promise<ResolvedTargetResult> {
  if (headReader === undefined) {
    return failureResult('unsupportedCheckoutTarget', 'HEAD checkout requires a head reader.', [
      diagnostic('VERSION_CHECKOUT_MISSING_HEAD_READER', 'HEAD checkout requires a head reader.'),
    ]);
  }

  let result: CheckoutHeadReadResult;
  try {
    result = await headReader.readHead();
  } catch (error) {
    return failureResult('checkoutRefReadFailed', 'Head reader failed while resolving HEAD.', [
      diagnostic('VERSION_CHECKOUT_REF_READ_FAILED', 'Head reader failed while resolving HEAD.', {
        details: { cause: errorName(error) },
      }),
    ]);
  }

  if (!result.ok) {
    const denied = checkoutAccessDeniedDiagnosticFromSources(
      result.diagnostics,
      'HEAD checkout is not authorized for this caller.',
    );
    if (denied) {
      return failureResult(
        'checkoutAccessDenied',
        'HEAD checkout is not authorized for this caller.',
        [denied],
      );
    }
    return failureResult('checkoutRefReadFailed', 'Head reader failed while resolving HEAD.', [
      diagnostic('VERSION_CHECKOUT_REF_READ_FAILED', 'Head reader failed while resolving HEAD.', {
        sourceDiagnostics: result.diagnostics,
      }),
    ]);
  }

  if (result.head.mode === 'detached') {
    const commitId = parseOptionalCommitId(result.head.commitId);
    return failureResult(
      'unsupportedCheckoutTarget',
      'Detached HEAD checkout materialization is not supported by this adapter.',
      [
        diagnostic(
          'VERSION_CHECKOUT_DETACHED_HEAD_UNSUPPORTED',
          'Detached HEAD checkout materialization is not supported by this adapter.',
          {
            ...(commitId === undefined ? {} : { commitId }),
            details: { materializationId: result.head.materializationId },
          },
        ),
      ],
    );
  }

  const refName = parseRefNameForTarget(result.head.refName);
  if (!refName.ok) return { ok: false, result: refName.result };

  const commitId = parseCommitIdForTarget(result.head.commitId, 'head.commitId');
  if (!commitId.ok) return { ok: false, result: commitId.result };

  return {
    ok: true,
    target: freezeResolvedTarget({
      kind: 'head',
      refName: refName.refName,
      commitId: commitId.commitId,
      ...(result.head.refVersion === undefined ? {} : { refVersion: result.head.refVersion }),
      ...(result.head.refIncarnationId === undefined
        ? {}
        : { refIncarnationId: result.head.refIncarnationId }),
    }),
    commitId: commitId.commitId,
    diagnostics: freezeDiagnostics(result.diagnostics ?? []),
  };
}

async function resolveRef(
  refName: RefName,
  refReader: CheckoutRefReader | undefined,
): Promise<ResolvedTargetResult> {
  if (refReader === undefined) {
    return failureResult('unsupportedCheckoutTarget', 'Ref checkout requires a ref reader.', [
      diagnostic('VERSION_CHECKOUT_MISSING_REF_READER', 'Ref checkout requires a ref reader.', {
        refName,
      }),
    ]);
  }

  let result: GetRefResult;
  try {
    result = await refReader.readRef(refName);
  } catch (error) {
    return failureResult('checkoutRefReadFailed', 'Ref reader failed while resolving checkout.', [
      diagnostic(
        'VERSION_CHECKOUT_REF_READ_FAILED',
        'Ref reader failed while resolving checkout.',
        {
          refName,
          details: { cause: errorName(error) },
        },
      ),
    ]);
  }

  if (!result.ok) {
    const denied = checkoutAccessDeniedDiagnosticFromSources(
      result.diagnostics,
      'Ref checkout is not authorized for this caller.',
      refName,
    );
    if (denied) {
      return failureResult(
        'checkoutAccessDenied',
        'Ref checkout is not authorized for this caller.',
        [denied],
      );
    }
    return failureResult('checkoutRefReadFailed', 'Ref reader failed while resolving checkout.', [
      diagnostic(
        'VERSION_CHECKOUT_REF_READ_FAILED',
        'Ref reader failed while resolving checkout.',
        {
          refName,
          sourceDiagnostics: result.diagnostics,
        },
      ),
    ]);
  }

  if (result.ref === null) {
    return failureResult('checkoutRefNotFound', 'Checkout ref was not found.', [
      diagnostic('VERSION_CHECKOUT_MISSING_REF', 'Checkout ref was not found.', { refName }),
    ]);
  }

  const target = freezeResolvedTarget({
    kind: 'ref',
    refName,
    commitId: result.ref.targetCommitId,
    refVersion: result.ref.refVersion,
    refIncarnationId: result.ref.refIncarnationId,
  });

  return {
    ok: true,
    target,
    commitId: result.ref.targetCommitId,
    diagnostics: freezeDiagnostics(result.diagnostics),
  };
}

function failureResult(
  code: CheckoutMaterializationErrorCode,
  message: string,
  diagnostics: readonly CheckoutMaterializationDiagnostic[],
): ResolvedTargetResult {
  return { ok: false, result: failure(code, message, diagnostics) };
}

function freezeResolvedTarget(
  target: CheckoutResolvedMaterializationTarget,
): CheckoutResolvedMaterializationTarget {
  if (target.kind === 'commit') {
    return Object.freeze({ kind: 'commit', commitId: target.commitId });
  }
  if (target.kind === 'ref') {
    return Object.freeze({
      kind: 'ref',
      refName: target.refName,
      commitId: target.commitId,
      refVersion: cloneRefVersion(target.refVersion),
      refIncarnationId: target.refIncarnationId,
    });
  }
  return Object.freeze({
    kind: 'head',
    refName: target.refName,
    commitId: target.commitId,
    ...(target.refVersion === undefined ? {} : { refVersion: cloneRefVersion(target.refVersion) }),
    ...(target.refIncarnationId === undefined ? {} : { refIncarnationId: target.refIncarnationId }),
  });
}

function cloneRefVersion(refVersion: RefVersion): RefVersion {
  return Object.freeze({ kind: refVersion.kind, value: refVersion.value });
}
