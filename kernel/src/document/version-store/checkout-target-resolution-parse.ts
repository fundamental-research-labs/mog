import { parseWorkbookCommitId, type WorkbookCommitId } from './object-digest';
import { validateRefName, type RefName, type RefNameDiagnostic } from './refs/ref-name';
import type { CheckoutMaterializationResult } from './checkout-service';
import {
  checkoutDiagnostic as diagnostic,
  checkoutFailure as failure,
  formatUnknown,
} from './checkout-service-diagnostics';
import type { ParsedCheckoutRequest } from './checkout-target-resolution-types';

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

export function parseCommitIdForTarget(
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

export function parseOptionalCommitId(value: unknown): WorkbookCommitId | undefined {
  try {
    return parseWorkbookCommitId(value);
  } catch {
    return undefined;
  }
}

export function parseRefNameForTarget(
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
