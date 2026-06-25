import type {
  VersionCheckoutOptions,
  VersionCheckoutTarget,
  VersionDiagnosticPublicPayload,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { CheckoutMaterializationRequest } from '../../../../document/version-store/checkout-service';
import {
  REF_NAME_STORAGE_PREFIX,
  validateRefName,
} from '../../../../document/version-store/refs/ref-name';
import {
  invalidOptionsDiagnostic,
  invalidTargetDiagnostic,
  requireCleanUnsupportedDiagnostic,
} from './version-checkout-diagnostic-factories';
import {
  formatUnknown,
  hasExactKeys,
  publicRefNameForBranch,
  toCommitId,
  VERSION_HEAD_REF,
} from './version-checkout-shared';

const VERSION_CHECKOUT_OPTION_KEYS = new Set(['includeDiagnostics', 'requireClean']);
const VERSION_CHECKOUT_TARGET_KIND_KEYS = new Set(['kind']);
const VERSION_CHECKOUT_TARGET_COMMIT_KEYS = new Set(['id', 'kind']);
const VERSION_CHECKOUT_TARGET_REF_KEYS = new Set(['kind', 'name']);

export type ParsedCheckoutTarget =
  | {
      readonly ok: true;
      readonly request: CheckoutMaterializationRequest;
      readonly payload: VersionDiagnosticPublicPayload;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export function validateCheckoutOptions(
  input: VersionCheckoutOptions,
): readonly VersionStoreDiagnostic[] {
  if (input === undefined) return [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return [
      invalidOptionsDiagnostic('checkout options must be an object when supplied.', {
        option: 'options',
      }),
    ];
  }

  const diagnostics: VersionStoreDiagnostic[] = [];
  for (const key of Object.keys(input)) {
    if (!VERSION_CHECKOUT_OPTION_KEYS.has(key)) {
      diagnostics.push(invalidOptionsDiagnostic('Unsupported checkout option.', { option: key }));
    }
  }

  if (
    'includeDiagnostics' in input &&
    input.includeDiagnostics !== undefined &&
    typeof input.includeDiagnostics !== 'boolean'
  ) {
    diagnostics.push(
      invalidOptionsDiagnostic('includeDiagnostics must be a boolean when supplied.', {
        option: 'includeDiagnostics',
      }),
    );
  }
  if (
    'requireClean' in input &&
    input.requireClean !== undefined &&
    typeof input.requireClean !== 'boolean'
  ) {
    diagnostics.push(
      invalidOptionsDiagnostic('requireClean must be a boolean when supplied.', {
        option: 'requireClean',
      }),
    );
  } else if (input.requireClean === false) {
    diagnostics.push(requireCleanUnsupportedDiagnostic());
  }

  return diagnostics;
}

export function validateCheckoutTarget(input: VersionCheckoutTarget): ParsedCheckoutTarget {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {
      ok: false,
      diagnostics: [
        invalidTargetDiagnostic('checkout target must be an object.', { option: 'target' }),
      ],
    };
  }
  const rawTarget = input as Readonly<Record<string, unknown>>;

  if (input.kind === 'head') {
    if (!hasExactKeys(input, VERSION_CHECKOUT_TARGET_KIND_KEYS)) {
      return {
        ok: false,
        diagnostics: [
          invalidTargetDiagnostic('HEAD checkout target must contain only kind.', {
            targetKind: 'head',
          }),
        ],
      };
    }
    return {
      ok: true,
      request: { target: 'ref', refName: VERSION_HEAD_REF },
      payload: { targetKind: 'head', refName: VERSION_HEAD_REF },
    };
  }

  if (input.kind === 'commit') {
    if (!hasExactKeys(input, VERSION_CHECKOUT_TARGET_COMMIT_KEYS)) {
      return {
        ok: false,
        diagnostics: [
          invalidTargetDiagnostic('Commit checkout target must contain kind and id.', {
            targetKind: 'commit',
          }),
        ],
      };
    }
    const commitId = toCommitId(input.id);
    if (!commitId) {
      return {
        ok: false,
        diagnostics: [
          invalidTargetDiagnostic('Checkout commit target id is invalid.', {
            targetKind: 'commit',
            option: 'id',
          }),
        ],
      };
    }
    return {
      ok: true,
      request: { target: 'commit', commitId },
      payload: { targetKind: 'commit', commitId },
    };
  }

  if (input.kind === 'ref') {
    if (!hasExactKeys(input, VERSION_CHECKOUT_TARGET_REF_KEYS)) {
      return {
        ok: false,
        diagnostics: [
          invalidTargetDiagnostic('Ref checkout target must contain kind and name.', {
            targetKind: 'ref',
          }),
        ],
      };
    }
    const ref = parseCheckoutRefName(input.name);
    if (!ref.ok) return { ok: false, diagnostics: ref.diagnostics };
    return {
      ok: true,
      request: { target: 'ref', refName: ref.serviceRefName },
      payload: {
        targetKind: ref.serviceRefName === VERSION_HEAD_REF ? 'head' : 'ref',
        refName: ref.publicRefName,
      },
    };
  }

  return {
    ok: false,
    diagnostics: [
      invalidTargetDiagnostic('Unsupported checkout target kind.', {
        targetKind: formatUnknown(rawTarget.kind),
      }),
    ],
  };
}

function parseCheckoutRefName(value: unknown):
  | {
      readonly ok: true;
      readonly serviceRefName: string;
      readonly publicRefName: string;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  if (value === VERSION_HEAD_REF) {
    return { ok: true, serviceRefName: VERSION_HEAD_REF, publicRefName: VERSION_HEAD_REF };
  }
  if (typeof value !== 'string') {
    return {
      ok: false,
      diagnostics: [
        invalidTargetDiagnostic('Checkout ref target name must be a string.', {
          targetKind: 'ref',
          option: 'name',
        }),
      ],
    };
  }

  const branchName = value.startsWith(REF_NAME_STORAGE_PREFIX)
    ? value.slice(REF_NAME_STORAGE_PREFIX.length)
    : value;
  const validated = validateRefName(branchName, 'target.name');
  if (!validated.ok) {
    return {
      ok: false,
      diagnostics: [
        invalidTargetDiagnostic('Checkout ref target is not public-safe.', {
          targetKind: 'ref',
          refName: 'redacted',
        }),
      ],
    };
  }

  return {
    ok: true,
    serviceRefName: validated.name,
    publicRefName: publicRefNameForBranch(validated.name),
  };
}
