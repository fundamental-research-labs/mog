import type {
  VersionMainRefName,
  VersionRefName,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import { getActiveCheckoutSessionReader } from './version-refs-active-session-service';
import type { AttachedVersionRefLifecycleService } from './version-refs-adapter';
import { publicDiagnostic, type VersionRefOperation } from './version-refs-public-diagnostics';
import { parsePublicBranchName } from './version-refs-validation';
import { isRecord, toCommitId } from './version-refs-values';

type BranchAdvanceOperation = Extract<VersionRefOperation, 'fastForwardBranch' | 'updateBranch'>;

type ActiveCheckoutBranchAdvanceInput = {
  readonly branchName: string;
  readonly refName: VersionMainRefName | VersionRefName;
  readonly expectedHead: WorkbookCommitId;
};

type ActiveCheckoutProjection =
  | { readonly status: 'absent' }
  | {
      readonly status: 'active';
      readonly refName: VersionMainRefName | VersionRefName;
      readonly checkedOutCommitId: WorkbookCommitId;
      readonly refHeadAtMaterialization: WorkbookCommitId;
    }
  | { readonly status: 'blocked'; readonly diagnostics: readonly VersionStoreDiagnostic[] };

type ProviderReadProjection =
  | { readonly status: 'read'; readonly value: unknown }
  | { readonly status: 'blocked'; readonly diagnostics: readonly VersionStoreDiagnostic[] };

type CurrentBranchHeadProjection =
  | { readonly status: 'checked'; readonly commitId: WorkbookCommitId }
  | { readonly status: 'blocked'; readonly diagnostics: readonly VersionStoreDiagnostic[] }
  | { readonly status: 'unchecked' };

export async function preflightActiveCheckoutBranchAdvance(
  ctx: DocumentContext,
  service: AttachedVersionRefLifecycleService,
  input: ActiveCheckoutBranchAdvanceInput,
  operation: BranchAdvanceOperation,
): Promise<readonly VersionStoreDiagnostic[]> {
  const activeSessionReader = getActiveCheckoutSessionReader(ctx, service);
  if (!activeSessionReader) return [];

  let active: ActiveCheckoutProjection;
  try {
    active = projectActiveCheckoutSession(await activeSessionReader(), operation);
  } catch {
    return [activeCheckoutPreflightReadFailedDiagnostic(operation, 'activeCheckoutSession')];
  }

  if (active.status === 'blocked') return active.diagnostics;
  if (active.status === 'absent' || active.refName !== input.refName) return [];

  if (active.checkedOutCommitId !== active.refHeadAtMaterialization) {
    return [staleActiveCheckoutBranchAdvanceDiagnostic(operation)];
  }

  const current = await readCurrentBranchHead(service, input.branchName, operation);
  if (current.status === 'blocked') return current.diagnostics;
  if (current.status === 'checked' && current.commitId !== active.refHeadAtMaterialization) {
    return [staleActiveCheckoutBranchAdvanceDiagnostic(operation)];
  }
  if (current.status === 'unchecked' && input.expectedHead !== active.refHeadAtMaterialization) {
    return [staleActiveCheckoutBranchAdvanceDiagnostic(operation)];
  }

  return [];
}

async function readCurrentBranchHead(
  service: AttachedVersionRefLifecycleService,
  branchName: string,
  operation: BranchAdvanceOperation,
): Promise<CurrentBranchHeadProjection> {
  if (!service.readBranch) return { status: 'unchecked' };
  try {
    return projectCurrentBranchHead(await service.readBranch({ name: branchName }), operation);
  } catch {
    return {
      status: 'blocked',
      diagnostics: [activeCheckoutPreflightReadFailedDiagnostic(operation, 'currentBranch')],
    };
  }
}

function projectCurrentBranchHead(
  value: unknown,
  operation: BranchAdvanceOperation,
): CurrentBranchHeadProjection {
  if (!isRecord(value) || value.ok === false || value.status === 'failed') {
    return {
      status: 'blocked',
      diagnostics: [activeCheckoutPreflightReadFailedDiagnostic(operation, 'currentBranch')],
    };
  }

  const ref =
    value.ok === true && isRecord(value.branch)
      ? isRecord(value.branch.ref)
        ? value.branch.ref
        : value.branch
      : value.status === 'success' && isRecord(value.ref)
        ? value.ref
        : isRecord(value.ref)
          ? value.ref
          : value;
  const commitId =
    toCommitId(ref.targetCommitId) ??
    toCommitId(ref.commitId) ??
    toCommitId(ref.previousTargetCommitId);

  return commitId
    ? { status: 'checked', commitId }
    : {
        status: 'blocked',
        diagnostics: [activeCheckoutPreflightReadFailedDiagnostic(operation, 'currentBranch')],
      };
}

function projectActiveCheckoutSession(
  value: unknown,
  operation: BranchAdvanceOperation,
): ActiveCheckoutProjection {
  const read = unwrapProviderReadValue(value, operation, 'activeCheckoutSession');
  if (read.status === 'blocked') return read;
  if (read.value === null) return { status: 'absent' };
  if (!isRecord(read.value)) {
    return {
      status: 'blocked',
      diagnostics: [
        activeCheckoutPreflightReadFailedDiagnostic(operation, 'activeCheckoutSession'),
      ],
    };
  }
  if (read.value.detached === true) return { status: 'absent' };

  const branchName =
    typeof read.value.branchName === 'string'
      ? read.value.branchName
      : typeof read.value.refName === 'string'
        ? read.value.refName
        : undefined;
  if (!branchName) {
    return {
      status: 'blocked',
      diagnostics: [
        activeCheckoutPreflightReadFailedDiagnostic(operation, 'activeCheckoutSession'),
      ],
    };
  }

  const parsed = parsePublicBranchName(branchName, operation);
  if (!parsed.ok) {
    return {
      status: 'blocked',
      diagnostics: [
        activeCheckoutPreflightReadFailedDiagnostic(operation, 'activeCheckoutSession'),
      ],
    };
  }

  const checkedOutCommitId = toCommitId(read.value.checkedOutCommitId);
  const refHeadAtMaterialization = toCommitId(read.value.refHeadAtMaterialization);
  if (!checkedOutCommitId || !refHeadAtMaterialization) {
    return {
      status: 'blocked',
      diagnostics: [
        activeCheckoutPreflightReadFailedDiagnostic(operation, 'activeCheckoutSession'),
      ],
    };
  }

  return {
    status: 'active',
    refName: parsed.refName,
    checkedOutCommitId,
    refHeadAtMaterialization,
  };
}

function unwrapProviderReadValue(
  value: unknown,
  operation: BranchAdvanceOperation,
  phase: 'activeCheckoutSession',
): ProviderReadProjection {
  if (value === null || value === undefined) return { status: 'read', value };
  if (!isRecord(value)) return { status: 'read', value };
  if (value.status === 'pending') {
    return {
      status: 'blocked',
      diagnostics: [activeCheckoutPreflightReadFailedDiagnostic(operation, `${phase}Pending`)],
    };
  }
  if (value.ok === false || value.status === 'failed' || value.status === 'degraded') {
    return {
      status: 'blocked',
      diagnostics: [activeCheckoutPreflightReadFailedDiagnostic(operation, `${phase}Failed`)],
    };
  }
  if (value.status === 'success' || value.ok === true) {
    return {
      status: 'read',
      value: unwrapSuccessfulProviderReadValue(value),
    };
  }
  return { status: 'read', value };
}

function unwrapSuccessfulProviderReadValue(value: Readonly<Record<string, unknown>>): unknown {
  if ('session' in value) return value.session;
  if ('current' in value) return value.current;
  if ('value' in value) return value.value;
  return value;
}

function staleActiveCheckoutBranchAdvanceDiagnostic(
  operation: BranchAdvanceOperation,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_CHECKOUT_STALE_WORKSPACE_HEAD',
    operation,
    'Version branch update is blocked because the active checkout session is stale relative to its branch head.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload: { operation, reason: 'staleCheckoutSession' },
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

function activeCheckoutPreflightReadFailedDiagnostic(
  operation: BranchAdvanceOperation,
  phase: string,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PROVIDER_ERROR',
    operation,
    'The version ref lifecycle service failed during active checkout preflight.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload: { operation, phase },
      mutationGuarantee: 'no-write-attempted',
    },
  );
}
