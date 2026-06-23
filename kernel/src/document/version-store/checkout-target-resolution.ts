import { parseWorkbookCommitId, type WorkbookCommitId } from './object-digest';
import type { RefVersion, GetRefResult } from './ref-store';
import { validateRefName, type RefName, type RefNameDiagnostic } from './ref-name';
import type {
  CheckoutHeadReader,
  CheckoutHeadReadResult,
  CheckoutMaterializationDiagnostic,
  CheckoutMaterializationErrorCode,
  CheckoutMaterializationRequest,
  CheckoutMaterializationResult,
  CheckoutRefReader,
  CheckoutResolvedMaterializationTarget,
} from './checkout-service';
import {
  checkoutAccessDeniedDiagnosticFromSources,
  checkoutDiagnostic as diagnostic,
  checkoutFailure as failure,
  errorName,
  formatUnknown,
  freezeCheckoutDiagnostics as freezeDiagnostics,
} from './checkout-service-diagnostics';

export type ParsedCheckoutRequest =
  | {
      readonly ok: true;
      readonly target: 'commit';
      readonly commitId: WorkbookCommitId;
    }
  | {
      readonly ok: true;
      readonly target: 'head';
    }
  | {
      readonly ok: true;
      readonly target: 'ref';
      readonly refName: RefName;
    }
  | {
      readonly ok: false;
      readonly result: CheckoutMaterializationResult;
    };

export type ResolvedTargetResult =
  | {
      readonly ok: true;
      readonly target: CheckoutResolvedMaterializationTarget;
      readonly commitId: WorkbookCommitId;
      readonly diagnostics: readonly CheckoutMaterializationDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly result: CheckoutMaterializationResult;
    };

export interface CheckoutTargetResolutionReaders {
  readonly headReader?: CheckoutHeadReader;
  readonly refReader?: CheckoutRefReader;
}

export function parseCheckoutMaterializationRequest(request: unknown): ParsedCheckoutRequest {
  if (!isPlainRecord(request)) {
    return invalidTarget('Checkout materialization request must be an object.');
  }

  if (request.target === 'commit') {
    if (!hasExactKeys(request, ['commitId', 'target'])) {
      return invalidTarget('Commit checkout target must contain exactly target and commitId.');
    }
    const commitId = parseCommitIdForTarget(request.commitId, 'commitId');
    if (!commitId.ok) return { ok: false, result: commitId.result };
    return { ok: true, target: 'commit', commitId: commitId.commitId };
  }

  if (request.target === 'ref') {
    if (!hasExactKeys(request, ['refName', 'target'])) {
      return invalidTarget('Ref checkout target must contain exactly target and refName.');
    }
    if (request.refName === 'HEAD') {
      return { ok: true, target: 'head' };
    }
    const refName = parseRefNameForTarget(request.refName);
    if (!refName.ok) return { ok: false, result: refName.result };
    return { ok: true, target: 'ref', refName: refName.refName };
  }

  if (request.target === 'detached') {
    return {
      ok: false,
      result: failure(
        'unsupportedCheckoutTarget',
        'Detached checkout targets are not supported by this adapter.',
        [
          diagnostic(
            'VERSION_CHECKOUT_DETACHED_TARGET_UNSUPPORTED',
            'Detached checkout targets are not supported by this adapter.',
          ),
        ],
      ),
    };
  }

  return {
    ok: false,
    result: failure('unsupportedCheckoutTarget', 'Unsupported checkout target.', [
      diagnostic('VERSION_CHECKOUT_UNSUPPORTED_TARGET', 'Unsupported checkout target.', {
        details: { target: formatUnknown(request.target) },
      }),
    ]),
  };
}

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

function parseCommitIdForTarget(
  value: unknown,
  path: string,
):
  | { readonly ok: true; readonly commitId: WorkbookCommitId }
  | { readonly ok: false; readonly result: CheckoutMaterializationResult } {
  try {
    return { ok: true, commitId: parseWorkbookCommitId(value, path) };
  } catch {
    return {
      ok: false,
      result: failure('invalidCheckoutTarget', `${path} must be commit:sha256:<64 hex>.`, [
        diagnostic('VERSION_CHECKOUT_INVALID_TARGET', `${path} must be commit:sha256:<64 hex>.`, {
          details: { path, received: formatUnknown(value) },
        }),
      ]),
    };
  }
}

function parseOptionalCommitId(value: unknown): WorkbookCommitId | undefined {
  try {
    return parseWorkbookCommitId(value);
  } catch {
    return undefined;
  }
}

function parseRefNameForTarget(
  value: unknown,
):
  | { readonly ok: true; readonly refName: RefName }
  | { readonly ok: false; readonly result: CheckoutMaterializationResult } {
  const result = validateRefName(value);
  if (result.ok) return { ok: true, refName: result.name };

  return {
    ok: false,
    result: failure('invalidCheckoutTarget', 'Checkout ref target is invalid.', [
      diagnostic('VERSION_CHECKOUT_INVALID_TARGET', 'Checkout ref target is invalid.', {
        sourceDiagnostics: redactedRefNameDiagnostics(result.diagnostics),
        details: malformedTargetRefDetails(value),
      }),
    ]),
  };
}

function redactedRefNameDiagnostics(
  diagnostics: readonly RefNameDiagnostic[],
): readonly RefNameDiagnostic[] {
  return Object.freeze(
    diagnostics.map((entry) =>
      Object.freeze({
        ...entry,
        ...(entry.value === undefined ? {} : { value: 'redacted' }),
      }),
    ),
  );
}

function malformedTargetRefDetails(
  value: unknown,
): Readonly<Record<string, string | number | boolean | null>> {
  return Object.freeze({
    received: 'redacted',
    receivedKind: unknownKind(value),
    redacted: true,
  });
}

function unknownKind(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function invalidTarget(message: string): ParsedCheckoutRequest {
  return {
    ok: false,
    result: failure('invalidCheckoutTarget', message, [
      diagnostic('VERSION_CHECKOUT_INVALID_TARGET', message),
    ]),
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

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
