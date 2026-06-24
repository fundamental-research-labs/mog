import type { SemanticWorkbookStateEnvelope } from '../../../bridges/compute/compute-types.gen';
import type { WorkbookCommit } from '../commit-store';
import type { VersionGraphNamespace } from '../object-store';
import {
  versionStoreDiagnostic,
  type VersionGraphStore,
  type VersionStoreDiagnostic,
} from '../provider';

const OBJECT_DIGEST_RE = /^[0-9a-f]{64}$/;

export async function readCommitSemanticState(
  graph: VersionGraphStore,
  commit: WorkbookCommit,
  namespace: VersionGraphNamespace,
): Promise<
  | { readonly ok: true; readonly semanticState: SemanticWorkbookStateEnvelope }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  try {
    const record = await graph.getObjectRecord<unknown>({
      kind: 'object',
      objectType: 'workbook.semanticChangeSet.v1',
      digest: commit.payload.semanticChangeSetDigest,
    });
    const semanticState = semanticStateEnvelopeFromPayload(record.preimage.payload);
    if (semanticState) return { ok: true, semanticState };
  } catch {
    return {
      ok: false,
      diagnostics: [
        versionStoreDiagnostic('VERSION_MISSING_CHANGE_SET', {
          operation: 'commitGraphWrite',
          namespace,
          safeMessage: 'Trusted XLSX reimport base semantic change set could not be read.',
          recoverability: 'repair',
          mutationGuarantee: 'no-write-attempted',
          details: { source: 'xlsx-import-change' },
        }),
      ],
    };
  }

  return {
    ok: false,
    diagnostics: [
      versionStoreDiagnostic('VERSION_MISSING_CHANGE_SET', {
        operation: 'commitGraphWrite',
        namespace,
        safeMessage:
          'Trusted XLSX reimport requires a base commit with a full semantic state envelope.',
        recoverability: 'unsupported',
        mutationGuarantee: 'no-write-attempted',
        details: { source: 'xlsx-import-change' },
      }),
    ],
  };
}

export function semanticDigestKey(digest: unknown): string {
  return JSON.stringify(digest);
}

function semanticStateEnvelopeFromPayload(payload: unknown): SemanticWorkbookStateEnvelope | null {
  if (!isRecord(payload)) return null;
  const semanticState = payload.semanticState;
  if (!isRecord(semanticState)) return null;
  if (!isRecord(semanticState.state)) return null;
  if (!isRecord(semanticState.stateDigest)) return null;
  if (!sourceSemanticStateDigestMatchesEnvelope(payload, semanticState.stateDigest)) return null;
  return semanticState as unknown as SemanticWorkbookStateEnvelope;
}

function sourceSemanticStateDigestMatchesEnvelope(
  payload: Record<string, unknown>,
  stateDigest: Record<string, unknown>,
): boolean {
  const source = payload.source;
  if (!isRecord(source) || !('semanticStateDigest' in source)) return true;
  const sourceDigestKey = objectDigestKey(source.semanticStateDigest);
  const stateDigestKey = objectDigestKey(stateDigest);
  return sourceDigestKey !== null && stateDigestKey !== null && sourceDigestKey === stateDigestKey;
}

function objectDigestKey(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (value.algorithm !== 'sha256') {
    return null;
  }
  if (typeof value.digest === 'string' && OBJECT_DIGEST_RE.test(value.digest)) {
    return `${value.algorithm}:${value.digest}`;
  }
  if (typeof value.value === 'string' && OBJECT_DIGEST_RE.test(value.value)) {
    return `${value.algorithm}:${value.value}`;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
