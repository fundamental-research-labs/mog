import { REF_NAME_STORAGE_PREFIX, validateRefName, type RefName } from '../refs/ref-name';
import type { LiveRefRecord } from '../refs/ref-store';
import type {
  VersionGraphCommitRef,
  VersionGraphRef,
  VersionGraphRefSelector,
  VersionGraphStoreDiagnostic,
  VersionGraphSymbolicRef,
} from './graph-store-types';
import type { VersionGraphStoreOperation } from './graph-store-operation';

export const VERSION_GRAPH_MAIN_REF = 'refs/heads/main';
export const VERSION_GRAPH_HEAD_REF = 'HEAD';

export type VersionGraphBranchRefName = `${typeof REF_NAME_STORAGE_PREFIX}${string}`;

export type ParsedGraphRefSelector =
  | { readonly ok: true; readonly name: typeof VERSION_GRAPH_HEAD_REF }
  | {
      readonly ok: true;
      readonly name: VersionGraphBranchRefName;
      readonly refName: RefName;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionGraphStoreDiagnostic[] };

type GraphRefDiagnosticFactory = (
  code: 'VERSION_INVALID_OPTIONS',
  message: string,
  options: Omit<VersionGraphStoreDiagnostic, 'code' | 'severity' | 'message'>,
) => VersionGraphStoreDiagnostic;

export function parseGraphRefSelector(
  value: VersionGraphRefSelector | string,
  diagnostic: GraphRefDiagnosticFactory,
  operation: VersionGraphStoreOperation = 'readRef',
): ParsedGraphRefSelector {
  if (value === VERSION_GRAPH_HEAD_REF) {
    return { ok: true, name: value };
  }

  if (typeof value === 'string' && value.startsWith(REF_NAME_STORAGE_PREFIX)) {
    const decoded = decodeGraphRefSuffix(value.slice(REF_NAME_STORAGE_PREFIX.length));
    if (!decoded.ok) {
      return {
        ok: false,
        diagnostics: [
          diagnostic('VERSION_INVALID_OPTIONS', decoded.message, {
            operation,
            option: 'ref',
            details: { receivedRef: String(value) },
          }),
        ],
      };
    }

    const parsed = validateRefName(decoded.value);
    if (parsed.ok) {
      return {
        ok: true,
        name: graphRefNameFromRefName(parsed.name),
        refName: parsed.name,
      };
    }
  }

  return {
    ok: false,
    diagnostics: [
      diagnostic(
        'VERSION_INVALID_OPTIONS',
        'Graph reads support HEAD or refs/heads/<public branch> refs.',
        {
          operation,
          option: 'ref',
          details: { receivedRef: String(value) },
        },
      ),
    ],
  };
}

export function parseGraphCommitTargetRef(
  value: VersionGraphBranchRefName | string | undefined,
  diagnostic: GraphRefDiagnosticFactory,
):
  | { readonly ok: true; readonly name: VersionGraphBranchRefName; readonly refName: RefName }
  | { readonly ok: false; readonly diagnostics: readonly VersionGraphStoreDiagnostic[] } {
  const parsed = parseGraphRefSelector(value ?? VERSION_GRAPH_MAIN_REF, diagnostic);
  if (!parsed.ok) return parsed;
  if (parsed.name === VERSION_GRAPH_HEAD_REF) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'VERSION_INVALID_OPTIONS',
          'Graph commits must target refs/heads/<public branch>; HEAD is symbolic.',
          { operation: 'commit', option: 'ref' },
        ),
      ],
    };
  }
  return parsed;
}

export function missingGraphCommitExpectedRefVersionDiagnostic(
  refName: VersionGraphBranchRefName,
  diagnostic: GraphRefDiagnosticFactory,
): VersionGraphStoreDiagnostic {
  return diagnostic(
    'VERSION_INVALID_OPTIONS',
    'Graph commit requires an expected ref version for the target ref.',
    {
      operation: 'commit',
      option: 'ref',
      refName,
      details: { missingField: 'expectedTargetRefVersion' },
    },
  );
}

export function graphRefFromLiveRef(ref: LiveRefRecord): VersionGraphRef {
  return {
    name: graphRefNameFromRefName(ref.name),
    commitId: ref.targetCommitId,
    revision: ref.refVersion,
    updatedAt: ref.updatedAt,
    providerRefId: ref.providerRefId,
    providerEpoch: ref.providerEpoch,
    refIncarnationId: ref.refIncarnationId,
    protected: ref.protected,
  };
}

export function graphRefNameFromRefName(name: RefName): VersionGraphBranchRefName {
  return `${REF_NAME_STORAGE_PREFIX}${name}` as VersionGraphBranchRefName;
}

export function symbolicHeadFromLiveRef(ref: LiveRefRecord): VersionGraphSymbolicRef {
  return {
    name: VERSION_GRAPH_HEAD_REF,
    target: VERSION_GRAPH_MAIN_REF,
    revision: ref.refVersion,
  };
}

export function commitRefFromLiveRef(
  ref: LiveRefRecord,
  resolvedFrom: VersionGraphRefSelector,
): VersionGraphCommitRef {
  return {
    id: ref.targetCommitId,
    refName: graphRefNameFromRefName(ref.name),
    resolvedFrom,
    refRevision: ref.refVersion,
  };
}

function decodeGraphRefSuffix(
  value: string,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly message: string } {
  if (value.length === 0) {
    return { ok: false, message: 'refs/heads/* graph ref must include a branch name.' };
  }
  if (!value.includes('%')) {
    return { ok: true, value };
  }

  try {
    return { ok: true, value: decodeURIComponent(value) };
  } catch {
    return { ok: false, message: 'refs/heads/* graph ref contains invalid percent encoding.' };
  }
}
