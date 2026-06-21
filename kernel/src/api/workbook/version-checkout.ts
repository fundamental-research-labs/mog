import type {
  VersionCheckoutDependencyRole,
  VersionCheckoutDependencySummary,
  VersionCheckoutOptions,
  VersionCheckoutPlan,
  VersionCheckoutResolvedTarget,
  VersionCheckoutResult,
  VersionCheckoutTarget,
  VersionDiagnosticPublicPayload,
  VersionMainRefName,
  VersionRecordRevision,
  VersionRefName,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import type {
  CheckoutMaterializationRequest,
  CheckoutMaterializationResult,
} from '../../document/version-store/checkout-service';
import {
  REF_NAME_STORAGE_PREFIX,
  validateRefName,
} from '../../document/version-store/ref-name';

const VERSION_HEAD_REF = 'HEAD';
const VERSION_MAIN_REF = 'refs/heads/main' satisfies VersionMainRefName;
const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const VERSION_CHECKOUT_OPTION_KEYS = new Set(['includeDiagnostics']);
const VERSION_CHECKOUT_TARGET_KIND_KEYS = new Set(['kind']);
const VERSION_CHECKOUT_TARGET_COMMIT_KEYS = new Set(['id', 'kind']);
const VERSION_CHECKOUT_TARGET_REF_KEYS = new Set(['kind', 'name']);
const VERSION_CHECKOUT_DEPENDENCY_ROLES = new Set<VersionCheckoutDependencyRole>([
  'snapshotRoot',
  'semanticChangeSet',
  'mutationSegment',
  'redactionSummary',
  'verificationSummary',
]);

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

type VersionCheckoutOperation = 'checkout';

type AttachedCheckoutMaterializationService = {
  planCheckout?: (request: CheckoutMaterializationRequest) => MaybePromise<unknown>;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

type ParsedCheckoutTarget =
  | {
      readonly ok: true;
      readonly request: CheckoutMaterializationRequest;
      readonly payload: VersionDiagnosticPublicPayload;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export async function checkoutWorkbookVersion(
  ctx: DocumentContext,
  target: VersionCheckoutTarget,
  options: VersionCheckoutOptions = {},
): Promise<VersionCheckoutResult> {
  const optionDiagnostics = validateCheckoutOptions(options);
  if (optionDiagnostics.length > 0) {
    return degradedCheckout(optionDiagnostics);
  }

  const parsed = validateCheckoutTarget(target);
  if (!parsed.ok) {
    return degradedCheckout(parsed.diagnostics);
  }

  const service = getAttachedCheckoutMaterializationService(ctx);
  if (!service?.planCheckout) {
    return degradedCheckout([serviceUnavailableDiagnostic(parsed.payload)]);
  }

  try {
    return mapCheckoutResult(await service.planCheckout(parsed.request), parsed.payload);
  } catch {
    return degradedCheckout([providerErrorDiagnostic(parsed.payload)]);
  }
}

function getAttachedCheckoutMaterializationService(
  ctx: DocumentContext,
): AttachedCheckoutMaterializationService | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return null;

  for (const candidate of [
    services.checkoutService,
    services.checkoutMaterializationService,
    services.materializationService,
    services.versionCheckoutService,
    services.publicCheckoutService,
    services,
  ]) {
    const service = toCheckoutMaterializationService(candidate);
    if (service) return service;
  }

  return null;
}

function toCheckoutMaterializationService(
  value: unknown,
): AttachedCheckoutMaterializationService | null {
  const planCheckout = bindMethod(value, 'planCheckout');
  if (!planCheckout) return null;

  return {
    planCheckout: (request) => planCheckout(request),
  };
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function validateCheckoutOptions(
  input: VersionCheckoutOptions,
): readonly VersionStoreDiagnostic[] {
  if (input === undefined) return [];
  if (!isRecord(input) || Array.isArray(input)) {
    return [
      invalidOptionsDiagnostic(
        'checkout options must be an object when supplied.',
        { option: 'options' },
      ),
    ];
  }

  const diagnostics: VersionStoreDiagnostic[] = [];
  for (const key of Object.keys(input)) {
    if (!VERSION_CHECKOUT_OPTION_KEYS.has(key)) {
      diagnostics.push(
        invalidOptionsDiagnostic('Unsupported checkout option.', { option: key }),
      );
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

  return diagnostics;
}

function validateCheckoutTarget(input: VersionCheckoutTarget): ParsedCheckoutTarget {
  if (!isRecord(input) || Array.isArray(input)) {
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

function parseCheckoutRefName(
  value: unknown,
):
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

function mapCheckoutResult(
  value: unknown,
  fallbackPayload: VersionDiagnosticPublicPayload,
): VersionCheckoutResult {
  if (!isRecord(value)) {
    return degradedCheckout([providerErrorDiagnostic(fallbackPayload)]);
  }

  if (value.ok === true) {
    const plan = mapCheckoutPlan(value.plan);
    if (!plan) {
      return degradedCheckout([invalidPayloadDiagnostic(fallbackPayload)]);
    }
    return {
      status: 'success',
      materialization: 'planned',
      plan,
      diagnostics: mapCheckoutDiagnostics(value.diagnostics, fallbackPayload),
      mutationGuarantee: 'no-workbook-mutation',
    };
  }

  if (value.ok === false) {
    return degradedCheckout(
      mapCheckoutDiagnostics(
        Array.isArray(value.diagnostics)
          ? value.diagnostics
          : isRecord(value.error)
            ? value.error.diagnostics
            : undefined,
        fallbackPayload,
      ),
    );
  }

  return degradedCheckout([providerErrorDiagnostic(fallbackPayload)]);
}

function mapCheckoutPlan(value: unknown): VersionCheckoutPlan | null {
  if (!isRecord(value) || value.strategy !== 'fullSnapshot') return null;

  const target = mapResolvedTarget(value.resolvedTarget);
  const commitId = toCommitId(value.commitId);
  const parentCommitIds = Array.isArray(value.parentCommitIds)
    ? value.parentCommitIds.map(toCommitId)
    : null;
  const requiredDependencies = Array.isArray(value.requiredDependencies)
    ? value.requiredDependencies.map(mapRequiredDependency)
    : null;

  if (
    !target ||
    !commitId ||
    !parentCommitIds ||
    parentCommitIds.some((parent): parent is null => parent === null) ||
    !requiredDependencies ||
    requiredDependencies.some((dependency): dependency is null => dependency === null)
  ) {
    return null;
  }

  const dependencies = requiredDependencies as VersionCheckoutDependencySummary[];
  return {
    strategy: 'fullSnapshot',
    target,
    commitId,
    parentCommitIds: parentCommitIds as WorkbookCommitId[],
    requiredDependencies: dependencies,
    requiredDependencyCount: dependencies.length,
  };
}

function mapResolvedTarget(value: unknown): VersionCheckoutResolvedTarget | null {
  if (!isRecord(value)) return null;

  if (value.kind === 'commit') {
    const commitId = toCommitId(value.commitId);
    return commitId ? { kind: 'commit', commitId } : null;
  }

  if (value.kind === 'ref') {
    const refName = toPublicRefName(value.refName);
    const commitId = toCommitId(value.commitId);
    const refRevision = toRevision(value.refVersion);
    if (!refName || !commitId || !refRevision) return null;
    return {
      kind: 'ref',
      refName,
      commitId,
      refRevision,
      ...(typeof value.refIncarnationId === 'string'
        ? { refIncarnationId: value.refIncarnationId }
        : {}),
    };
  }

  if (value.kind === 'head') {
    const refName = toPublicRefName(value.refName);
    const commitId = toCommitId(value.commitId);
    if (!refName || !commitId) return null;
    const refRevision = toRevision(value.refVersion);
    return {
      kind: 'head',
      refName,
      commitId,
      ...(refRevision ? { refRevision } : {}),
      ...(typeof value.refIncarnationId === 'string'
        ? { refIncarnationId: value.refIncarnationId }
        : {}),
    };
  }

  return null;
}

function mapRequiredDependency(value: unknown): VersionCheckoutDependencySummary | null {
  if (!isRecord(value)) return null;
  const role = value.role;
  if (typeof role !== 'string' || !VERSION_CHECKOUT_DEPENDENCY_ROLES.has(role as VersionCheckoutDependencyRole)) {
    return null;
  }
  if (typeof value.objectType !== 'string') return null;
  return {
    role: role as VersionCheckoutDependencyRole,
    objectType: value.objectType,
    ...(typeof value.index === 'number' && Number.isInteger(value.index)
      ? { index: value.index }
      : {}),
  };
}

function mapCheckoutDiagnostics(
  value: unknown,
  fallbackPayload: VersionDiagnosticPublicPayload,
): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  return value.map((entry) => mapCheckoutDiagnostic(entry, fallbackPayload));
}

function mapCheckoutDiagnostic(
  value: unknown,
  fallbackPayload: VersionDiagnosticPublicPayload,
): VersionStoreDiagnostic {
  if (!isRecord(value)) return providerErrorDiagnostic(fallbackPayload);

  const issueCode =
    typeof value.issueCode === 'string'
      ? value.issueCode
      : typeof value.code === 'string'
        ? value.code
        : 'VERSION_CHECKOUT_PROVIDER_ERROR';
  const severity = value.severity === 'corruption' ? 'error' : value.severity;

  return publicDiagnostic(issueCode, safeMessageForIssue(issueCode), {
    severity:
      severity === 'info' || severity === 'warning' || severity === 'error' || severity === 'fatal'
        ? severity
        : 'error',
    recoverability: recoverabilityForIssue(issueCode),
    payload: sanitizeCheckoutDiagnosticPayload(value, fallbackPayload),
  });
}

function sanitizeCheckoutDiagnosticPayload(
  value: Readonly<Record<string, unknown>>,
  fallbackPayload: VersionDiagnosticPublicPayload,
): VersionDiagnosticPublicPayload {
  const payload: Record<string, string | number | boolean | null> = {
    operation: 'checkout',
    ...fallbackPayload,
  };

  const commitId = toCommitId(value.commitId);
  if (commitId) payload.commitId = commitId;

  if (typeof value.refName === 'string') {
    payload.refName = safePublicDiagnosticRefName(value.refName);
  }

  if (isRecord(value.dependency)) {
    const dependency = value.dependency;
    if (typeof dependency.objectType === 'string') {
      payload.objectType = dependency.objectType;
    }
  }

  if (typeof value.objectType === 'string') payload.objectType = value.objectType;
  if (typeof value.role === 'string') payload.dependencyRole = value.role;

  const details = isRecord(value.details) ? value.details : null;
  if (details) {
    for (const key of ['path', 'target', 'cause'] as const) {
      const detailValue = details[key];
      if (isPayloadPrimitive(detailValue)) payload[key] = detailValue;
    }
  }

  return payload;
}

function serviceUnavailableDiagnostic(
  payload: VersionDiagnosticPublicPayload,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_CHECKOUT_SERVICE_UNAVAILABLE',
    'No document-scoped checkout materialization service is attached; no workbook state is fabricated.',
    {
      severity: 'warning',
      recoverability: 'unsupported',
      payload,
    },
  );
}

function invalidTargetDiagnostic(
  safeMessage: string,
  payload: VersionDiagnosticPublicPayload,
): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_CHECKOUT_INVALID_TARGET', safeMessage, {
    severity: 'error',
    recoverability: 'none',
    payload,
  });
}

function invalidOptionsDiagnostic(
  safeMessage: string,
  payload: VersionDiagnosticPublicPayload,
): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_INVALID_OPTIONS', safeMessage, {
    severity: 'error',
    recoverability: 'none',
    payload,
  });
}

function invalidPayloadDiagnostic(
  payload: VersionDiagnosticPublicPayload,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_INVALID_COMMIT_PAYLOAD',
    'The checkout materialization service returned an invalid public checkout plan.',
    {
      severity: 'error',
      recoverability: 'repair',
      payload,
    },
  );
}

function providerErrorDiagnostic(
  payload: VersionDiagnosticPublicPayload,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_CHECKOUT_PROVIDER_ERROR',
    'The checkout materialization service failed before returning a usable public result.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload,
    },
  );
}

function publicDiagnostic(
  issueCode: string,
  safeMessage: string,
  options: {
    readonly severity?: VersionStoreDiagnostic['severity'];
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly payload?: VersionDiagnosticPublicPayload;
  } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: options.severity ?? 'error',
    recoverability: options.recoverability ?? recoverabilityForIssue(issueCode),
    messageTemplateId: `version.checkout.${issueCode}`,
    safeMessage,
    ...(options.payload ? { payload: options.payload } : {}),
    redacted: true,
  };
}

function safeMessageForIssue(issueCode: string): string {
  switch (issueCode) {
    case 'VERSION_CHECKOUT_INVALID_TARGET':
      return 'The checkout target is invalid for the public version facade.';
    case 'VERSION_CHECKOUT_UNSUPPORTED_TARGET':
    case 'VERSION_CHECKOUT_DETACHED_TARGET_UNSUPPORTED':
    case 'VERSION_CHECKOUT_DETACHED_HEAD_UNSUPPORTED':
      return 'The requested checkout target is unsupported by this public checkout facade.';
    case 'VERSION_CHECKOUT_MISSING_REF_READER':
    case 'VERSION_CHECKOUT_MISSING_HEAD_READER':
    case 'VERSION_CHECKOUT_SERVICE_UNAVAILABLE':
      return 'No document-scoped checkout materialization service is attached for this target.';
    case 'VERSION_CHECKOUT_REF_READ_FAILED':
      return 'The checkout service could not resolve the target ref.';
    case 'VERSION_CHECKOUT_MISSING_REF':
      return 'The checkout target ref was not found.';
    case 'VERSION_CHECKOUT_MISSING_COMMIT':
      return 'The checkout target commit was not found.';
    case 'VERSION_CHECKOUT_COMMIT_READ_FAILED':
      return 'The checkout service could not read the target commit.';
    case 'VERSION_CHECKOUT_COMMIT_COMPLETENESS_DIAGNOSTIC':
      return 'The target commit has non-blocking checkout completeness diagnostics.';
    case 'VERSION_CHECKOUT_UNMATERIALIZABLE_COMMIT':
      return 'The target commit is not materializable by the attached checkout service.';
    case 'VERSION_CHECKOUT_MISSING_DEPENDENCY':
      return 'The target commit is missing required checkout materialization dependencies.';
    case 'VERSION_CHECKOUT_DEPENDENCY_READ_FAILED':
      return 'The checkout service could not preflight materialization dependencies.';
    default:
      return 'The checkout materialization service could not complete checkout planning.';
  }
}

function recoverabilityForIssue(issueCode: string): VersionStoreDiagnostic['recoverability'] {
  switch (issueCode) {
    case 'VERSION_CHECKOUT_REF_READ_FAILED':
    case 'VERSION_CHECKOUT_COMMIT_READ_FAILED':
    case 'VERSION_CHECKOUT_DEPENDENCY_READ_FAILED':
    case 'VERSION_CHECKOUT_PROVIDER_ERROR':
      return 'retry';
    case 'VERSION_CHECKOUT_MISSING_COMMIT':
    case 'VERSION_CHECKOUT_MISSING_DEPENDENCY':
    case 'VERSION_CHECKOUT_UNMATERIALIZABLE_COMMIT':
      return 'repair';
    case 'VERSION_CHECKOUT_UNSUPPORTED_TARGET':
    case 'VERSION_CHECKOUT_DETACHED_TARGET_UNSUPPORTED':
    case 'VERSION_CHECKOUT_DETACHED_HEAD_UNSUPPORTED':
    case 'VERSION_CHECKOUT_MISSING_REF_READER':
    case 'VERSION_CHECKOUT_MISSING_HEAD_READER':
    case 'VERSION_CHECKOUT_MISSING_REF':
    case 'VERSION_CHECKOUT_SERVICE_UNAVAILABLE':
      return 'unsupported';
    default:
      return 'none';
  }
}

function degradedCheckout(
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionCheckoutResult {
  return {
    status: 'degraded',
    materialization: 'not-applied',
    plan: null,
    diagnostics,
    mutationGuarantee: 'no-workbook-mutation',
  };
}

function toCommitId(value: unknown): WorkbookCommitId | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : null;
}

function toRevision(value: unknown): VersionRecordRevision | undefined {
  if (isRecord(value) && value.kind === 'counter' && typeof value.value === 'string') {
    return { kind: 'counter', value: value.value };
  }
  if (isRecord(value) && value.kind === 'opaque' && typeof value.value === 'string') {
    return { kind: 'opaque', value: value.value };
  }
  return undefined;
}

function toPublicRefName(value: unknown): VersionMainRefName | VersionRefName | null {
  if (typeof value !== 'string') return null;
  if (value === VERSION_HEAD_REF) return null;
  const branchName = value.startsWith(REF_NAME_STORAGE_PREFIX)
    ? value.slice(REF_NAME_STORAGE_PREFIX.length)
    : value;
  const validated = validateRefName(branchName);
  if (!validated.ok) return null;
  return publicRefNameForBranch(validated.name);
}

function publicRefNameForBranch(name: string): VersionMainRefName | VersionRefName {
  if (name === 'main') return VERSION_MAIN_REF;
  return `${REF_NAME_STORAGE_PREFIX}${name}` as VersionRefName;
}

function safePublicDiagnosticRefName(value: string): string {
  if (value === VERSION_HEAD_REF || value === VERSION_MAIN_REF) return value;
  const publicRef = toPublicRefName(value);
  return publicRef ?? 'redacted';
}

function hasExactKeys(value: Readonly<Record<string, unknown>>, expectedKeys: Set<string>): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isPayloadPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function formatUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return typeof value;
}
