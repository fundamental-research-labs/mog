import {
  WORKBOOK_FACADE_CAPABILITY_MATRIX,
  WORKBOOK_SUB_API_INTERFACES,
  type SpreadsheetFacadeMatrixEntry,
} from './workbook-facade-capability-matrix';
import { projectVersionSurfaceStatusForPolicy } from './version-surface-status';
import {
  SPREADSHEET_ACTOR_SESSION_BRAND,
  type InternalSpreadsheetActorSession,
} from './actor-session';
import { toPublicError } from './public-error';
import type {
  SpreadsheetActorRef,
  SpreadsheetActorSession,
  SpreadsheetAuthorizationResult,
  SpreadsheetCapability,
  SpreadsheetPolicyDecision,
  SpreadsheetPolicySnapshot,
  SpreadsheetResolvedActor,
  SpreadsheetWorkbookFacade,
} from './public-types';
import type { WorkbookRecord } from './runtime-types';

export type FacadeBinding = {
  readonly actor: SpreadsheetResolvedActor;
  readonly policy: SpreadsheetPolicySnapshot;
  readonly brand: import('./actor-session').ActorSessionBrand;
} | null;

const FACADE_BRAND: unique symbol = Symbol('mog.spreadsheet-app.facade');
const DENIED_RAW_FACADE_PROPERTIES = new Set(['context', 'ctx', 'eventBus', 'mirror', 'uiStore']);

export function createEvent(
  record: WorkbookRecord,
  type: import('./public-types').SpreadsheetAppEvent['type'],
  payload: import('./public-types').SpreadsheetAppEvent['payload'],
  sequence: number,
): import('./public-types').SpreadsheetAppEvent {
  return {
    type,
    workbookId: record.workbookId,
    epoch: record.epoch,
    sequence,
    source: 'system',
    payload,
  } as import('./public-types').SpreadsheetAppEvent;
}

export function isActorSession(
  value: SpreadsheetActorRef | SpreadsheetActorSession | undefined,
): value is InternalSpreadsheetActorSession {
  return Boolean(value && typeof value === 'object' && SPREADSHEET_ACTOR_SESSION_BRAND in value);
}

export function implicitHostActor(): SpreadsheetResolvedActor {
  return { actorId: 'trusted-host', kind: 'host', displayName: 'Trusted host' };
}

export function actorRefFromInput(
  input: SpreadsheetActorRef | SpreadsheetActorSession | undefined,
): SpreadsheetActorRef | undefined {
  if (!input) return undefined;
  if (isActorSession(input)) {
    return {
      actorId: input.actor.actorId,
      kind: input.actor.kind,
      displayName: input.actor.displayName,
    };
  }
  if ('actorId' in input) return input;
  if ('actor' in input) {
    return {
      actorId: input.actor.actorId,
      kind: input.actor.kind,
      displayName: input.actor.displayName,
    };
  }
  return undefined;
}

export function defaultAllowedAuthorization(): SpreadsheetAuthorizationResult {
  return { decision: 'allowed', policyVersion: 'implicit-trusted-host' };
}

export function deniedAuthorization(reason: string): SpreadsheetAuthorizationResult {
  return { decision: 'denied', policyVersion: 'implicit-trusted-host', reason };
}

function symbolMethodName(prop: symbol): string | null {
  const asyncDispose = (Symbol as unknown as { readonly asyncDispose?: symbol }).asyncDispose;
  if (asyncDispose && prop === asyncDispose) return '[Symbol.asyncDispose]';
  return null;
}

function facadeMethodName(prop: string | symbol): string | null {
  return typeof prop === 'string' ? prop : symbolMethodName(prop);
}

export function policyDecision(
  policy: SpreadsheetPolicySnapshot,
  capability: SpreadsheetCapability,
): SpreadsheetPolicyDecision {
  return (
    policy.decisions.find((decision) => decision.capability === capability)?.decision ?? 'denied'
  );
}

type VersionCapability = Extract<SpreadsheetCapability, `version:${string}`>;

type FacadeCapabilityDenial = {
  readonly capability: SpreadsheetCapability;
  readonly decision: Exclude<SpreadsheetPolicyDecision, 'allowed'>;
  readonly deniedCapabilities: readonly SpreadsheetCapability[];
};

function entryCapabilities(entry: SpreadsheetFacadeMatrixEntry): readonly SpreadsheetCapability[] {
  return entry.capabilities ?? (entry.capability ? [entry.capability] : []);
}

function conditionalCapabilityMatches(
  conditional: NonNullable<SpreadsheetFacadeMatrixEntry['conditionalCapabilities']>[number],
  args: readonly unknown[],
): boolean {
  let value = args[conditional.when.argumentIndex];
  let parent: unknown = undefined;
  let property: string | undefined;
  for (const segment of conditional.when.path) {
    if (!value || typeof value !== 'object') return false;
    parent = value;
    property = segment;
    value = (value as Record<string, unknown>)[segment];
  }
  if (conditional.when.presence === 'present') {
    return Boolean(
      parent &&
      typeof parent === 'object' &&
      property &&
      Object.hasOwn(parent, property) &&
      value !== undefined,
    );
  }
  return false;
}

function entryCapabilitiesForArgs(
  entry: SpreadsheetFacadeMatrixEntry,
  args: readonly unknown[] = [],
): readonly SpreadsheetCapability[] {
  const capabilities = [...entryCapabilities(entry)];
  for (const conditional of entry.conditionalCapabilities ?? []) {
    if (conditionalCapabilityMatches(conditional, args)) {
      capabilities.push(...conditional.capabilities);
    }
  }
  return capabilities;
}

function isVersionCapability(capability: SpreadsheetCapability): capability is VersionCapability {
  return capability.startsWith('version:');
}

function isVersionResultFacadeMethod(
  interfaceName: string,
  methodName: string,
  entry: SpreadsheetFacadeMatrixEntry,
): boolean {
  if (interfaceName !== 'WorkbookVersion') return false;
  if (methodName === 'getSurfaceStatus' || methodName === 'getStatus') return false;
  const capabilities = [
    ...entryCapabilities(entry),
    ...(entry.conditionalCapabilities ?? []).flatMap((conditional) => conditional.capabilities),
  ];
  return capabilities.length > 0 && capabilities.every(isVersionCapability);
}

function projectVersionFacadeResult(
  value: unknown,
  interfaceName: string,
  methodName: string,
  binding: FacadeBinding,
): unknown {
  if (interfaceName !== 'WorkbookVersion' || methodName !== 'getSurfaceStatus') return value;
  const policy = binding?.policy;
  if (!policy) return value;
  if (value && typeof (value as { readonly then?: unknown }).then === 'function') {
    return (value as Promise<unknown>).then((status) =>
      projectVersionSurfaceStatusForPolicy(status, policy),
    );
  }
  return projectVersionSurfaceStatusForPolicy(value, policy);
}

function facadeCapabilityDenial(
  record: WorkbookRecord,
  binding: FacadeBinding,
  entry: SpreadsheetFacadeMatrixEntry,
  operation: string,
  args: readonly unknown[] = [],
): FacadeCapabilityDenial | null {
  assertRecordUsable(record, operation);
  if (entry.decision === 'deny') {
    throw toPublicError(
      new Error(entry.reason ?? `${operation} is not exposed by the trusted embed workbook facade`),
      'AuthorizationDenied',
      false,
      { workbookId: record.workbookId, epoch: record.epoch, operation },
    );
  }
  if (!binding) return null;

  let firstDenied: FacadeCapabilityDenial | null = null;
  const deniedCapabilities: SpreadsheetCapability[] = [];
  for (const capability of entryCapabilitiesForArgs(entry, args)) {
    const decision = policyDecision(binding.policy, capability);
    if (decision === 'allowed') continue;
    deniedCapabilities.push(capability);
    firstDenied ??= { capability, decision, deniedCapabilities };
  }
  return firstDenied
    ? {
        capability: firstDenied.capability,
        decision: firstDenied.decision,
        deniedCapabilities,
      }
    : null;
}

function facadeCapabilityDeniedError(
  record: WorkbookRecord,
  binding: FacadeBinding,
  operation: string,
  denial: FacadeCapabilityDenial,
): Error {
  return toPublicError(
    new Error(`Capability "${denial.capability}" is ${denial.decision} for ${operation}`),
    denial.decision === 'approval-required' ? 'ApprovalRequired' : 'AuthorizationDenied',
    denial.decision === 'approval-required',
    { workbookId: record.workbookId, epoch: record.epoch, operation, actor: binding?.actor },
  );
}

function versionCapabilityDeniedResult(
  operation: string,
  denial: FacadeCapabilityDenial,
): Promise<{
  readonly ok: false;
  readonly error: {
    readonly code: 'version_capability_unavailable';
    readonly capability: VersionCapability;
    readonly dependency: 'hostCapability';
    readonly reason: string;
    readonly retryable: boolean;
    readonly diagnostics?: readonly {
      readonly code: string;
      readonly severity: 'error';
      readonly message: string;
      readonly dependency: 'hostCapability';
      readonly data: { readonly deniedCapabilities: readonly VersionCapability[] };
    }[];
  };
}> {
  const deniedVersionCapabilities = denial.deniedCapabilities.filter(isVersionCapability);
  const reason = `Capability "${denial.capability}" is ${denial.decision} for ${operation}`;
  return Promise.resolve({
    ok: false,
    error: {
      code: 'version_capability_unavailable',
      capability: denial.capability as VersionCapability,
      dependency: 'hostCapability',
      reason,
      retryable: denial.decision === 'approval-required',
      ...(deniedVersionCapabilities.length > 1
        ? {
            diagnostics: [
              {
                code: 'version_capability_denied',
                severity: 'error',
                message: reason,
                dependency: 'hostCapability',
                data: { deniedCapabilities: deniedVersionCapabilities },
              },
            ],
          }
        : {}),
    },
  });
}

export function assertRecordUsable(record: WorkbookRecord, operation: string): void {
  if (record.status === 'disposed') {
    throw toPublicError(new Error('Workbook is disposed'), 'Disposed', false, {
      workbookId: record.workbookId,
      epoch: record.epoch,
      operation,
      staleHandleImpact: 'current-workbook',
    });
  }
  if (record.status === 'stale') {
    throw toPublicError(
      new Error('Workbook handle is stale because its session is no longer active'),
      'StaleEpoch',
      false,
      {
        workbookId: record.workbookId,
        epoch: record.epoch,
        operation,
        staleHandleImpact: 'current-workbook',
      },
    );
  }
}

function assertFacadeAllowed(
  record: WorkbookRecord,
  binding: FacadeBinding,
  entry: SpreadsheetFacadeMatrixEntry,
  operation: string,
): void {
  const denial = facadeCapabilityDenial(record, binding, entry, operation);
  if (denial) throw facadeCapabilityDeniedError(record, binding, operation, denial);
}

function subApiInterfaceFor(interfaceName: string, prop: string): string | undefined {
  const subApis = WORKBOOK_SUB_API_INTERFACES as unknown as Record<
    string,
    Record<string, string | { targetInterface?: string }>
  >;
  const group =
    interfaceName === 'Workbook'
      ? (subApis.workbook ?? subApis.wb)
      : interfaceName === 'Worksheet'
        ? (subApis.worksheet ?? subApis.ws)
        : null;
  const entry = group?.[prop];
  return typeof entry === 'string' ? entry : entry?.targetInterface;
}

function matrixEntry(
  interfaceName: string,
  methodName: string,
): SpreadsheetFacadeMatrixEntry | undefined {
  return WORKBOOK_FACADE_CAPABILITY_MATRIX[
    interfaceName as keyof typeof WORKBOOK_FACADE_CAPABILITY_MATRIX
  ]?.[
    methodName as keyof (typeof WORKBOOK_FACADE_CAPABILITY_MATRIX)[keyof typeof WORKBOOK_FACADE_CAPABILITY_MATRIX]
  ] as SpreadsheetFacadeMatrixEntry | undefined;
}

function looksLikeFacadeTarget(value: unknown, interfaceName: string): value is object {
  if (!value || typeof value !== 'object') return false;
  if ((value as { readonly [FACADE_BRAND]?: true })[FACADE_BRAND]) return false;
  const entries =
    WORKBOOK_FACADE_CAPABILITY_MATRIX[
      interfaceName as keyof typeof WORKBOOK_FACADE_CAPABILITY_MATRIX
    ];
  if (!entries) return false;
  let matches = 0;
  for (const name of Object.keys(entries)) {
    if (name.startsWith('[')) continue;
    if (typeof (value as Record<string, unknown>)[name] === 'function') {
      matches += 1;
      if (matches >= 2) return true;
    }
  }
  return false;
}

function detectFacadeInterface(value: unknown, expected: readonly string[]): string | null {
  for (const interfaceName of expected) {
    if (looksLikeFacadeTarget(value, interfaceName)) return interfaceName;
  }
  for (const interfaceName of Object.keys(WORKBOOK_FACADE_CAPABILITY_MATRIX)) {
    if (interfaceName === 'Workbook') continue;
    if (looksLikeFacadeTarget(value, interfaceName)) return interfaceName;
  }
  return null;
}

function wrapFacadeReturn(
  value: unknown,
  record: WorkbookRecord,
  binding: FacadeBinding,
  expected: readonly string[] = [],
): unknown {
  if (!value) return value;
  if (typeof (value as { then?: unknown }).then === 'function') {
    return (value as Promise<unknown>).then((resolved) =>
      wrapFacadeReturn(resolved, record, binding, expected),
    );
  }
  if (Array.isArray(value)) {
    return value.map((item) => wrapFacadeReturn(item, record, binding, expected));
  }
  if (typeof value !== 'object') return value;

  const interfaceName = detectFacadeInterface(value, expected);
  if (interfaceName) {
    return createCapabilityFacade(record, value, interfaceName, binding);
  }

  if (expected.length === 0) return value;

  const clone: Record<string, unknown> = {};
  let changed = false;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const wrapped = wrapFacadeReturn(child, record, binding, expected);
    clone[key] = wrapped;
    changed ||= wrapped !== child;
  }
  return changed ? clone : value;
}

function createCapabilityFacade(
  record: WorkbookRecord,
  target: object,
  interfaceName: string,
  binding: FacadeBinding,
): object {
  const proxy = new Proxy(target, {
    get(currentTarget, prop, receiver) {
      if (prop === FACADE_BRAND) return true;
      if (interfaceName === 'Workbook') {
        if (prop === 'workbookId') return record.workbookId;
        if (prop === 'epoch') return record.epoch;
      }

      const methodName = facadeMethodName(prop);
      if (methodName) {
        if (DENIED_RAW_FACADE_PROPERTIES.has(methodName)) {
          throw toPublicError(
            new Error(
              `${interfaceName}.${methodName} is not exposed by the trusted embed workbook facade`,
            ),
            'AuthorizationDenied',
            false,
            {
              workbookId: record.workbookId,
              epoch: record.epoch,
              operation: `${interfaceName}.${methodName}`,
            },
          );
        }

        const subInterface = subApiInterfaceFor(interfaceName, methodName);
        if (subInterface) {
          assertRecordUsable(record, `${interfaceName}.${methodName}`);
          const subApi = Reflect.get(currentTarget, prop, currentTarget);
          return subApi && typeof subApi === 'object'
            ? createCapabilityFacade(record, subApi, subInterface, binding)
            : subApi;
        }

        const entry = matrixEntry(interfaceName, methodName);
        // Use `currentTarget` as the receiver for Reflect.get so that getters
        // (e.g. `activeSheet`) execute with `this === realObject`, not the proxy.
        // This prevents internal helper calls like `_ensureNotDisposed()` from
        // being intercepted by the proxy.
        const value = Reflect.get(currentTarget, prop, currentTarget);
        if (entry) {
          if (typeof value !== 'function') {
            assertFacadeAllowed(record, binding, entry, `${interfaceName}.${methodName}`);
            return wrapFacadeReturn(value, record, binding, entry.returns ?? []);
          }
          return (...args: unknown[]) => {
            const operation = `${interfaceName}.${methodName}`;
            const denial = facadeCapabilityDenial(record, binding, entry, operation, args);
            if (denial) {
              if (isVersionResultFacadeMethod(interfaceName, methodName, entry)) {
                return versionCapabilityDeniedResult(operation, denial);
              }
              throw facadeCapabilityDeniedError(record, binding, operation, denial);
            }
            const result = value.apply(currentTarget, args);
            return wrapFacadeReturn(
              projectVersionFacadeResult(result, interfaceName, methodName, binding),
              record,
              binding,
              entry.returns ?? [],
            );
          };
        }

        if (typeof value === 'function') {
          return () => {
            throw toPublicError(
              new Error(
                `${interfaceName}.${methodName} is missing a workbook facade capability-matrix decision`,
              ),
              'AuthorizationDenied',
              false,
              {
                workbookId: record.workbookId,
                epoch: record.epoch,
                operation: `${interfaceName}.${methodName}`,
              },
            );
          };
        }

        if (methodName === 'activeSheet') {
          assertFacadeAllowed(
            record,
            binding,
            { decision: 'allow', capability: 'workbook:read' },
            'Workbook.activeSheet',
          );
          return wrapFacadeReturn(value, record, binding, ['Worksheet']);
        }
      }

      const value = Reflect.get(currentTarget, prop, currentTarget);
      return wrapFacadeReturn(value, record, binding);
    },
  });

  return proxy;
}

export function createWorkbookFacade(
  record: WorkbookRecord,
  binding: FacadeBinding = null,
): SpreadsheetWorkbookFacade {
  return createCapabilityFacade(
    record,
    record.workbook as object,
    'Workbook',
    binding,
  ) as SpreadsheetWorkbookFacade;
}
