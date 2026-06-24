import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  type CheckoutHeadReadResult,
  type CheckoutMaterializationDiagnostic,
} from './checkout-service';
import { VERSION_GRAPH_MAIN_REF, type VersionGraphRef } from './graph';
import type { VersionGraphNamespace } from './object-store';
import type { VersionGraphStore } from './provider';
import { parseRefName, type RefName } from './refs/ref-name';
import type { GetRefResult, LiveRefRecord, VersionDiagnostic } from './refs/ref-store';
import { cloneRefVersion } from './snapshot-root-materialization-service-utils';

const MATERIALIZATION_REF_AUTHOR: VersionAuthor = Object.freeze({
  authorId: 'version-store',
  actorKind: 'system',
  displayName: 'Version Store',
});
const MATERIALIZATION_MAIN_REF_NAME = parseRefName('main');

export async function readGraphHead(graph: VersionGraphStore): Promise<CheckoutHeadReadResult> {
  const result = await graph.readHead();
  if (result.status !== 'success') {
    return {
      ok: false,
      diagnostics: checkoutDiagnostics(
        'VERSION_CHECKOUT_REF_READ_FAILED',
        'Version graph HEAD could not be read.',
        result.diagnostics,
      ),
    };
  }

  return {
    ok: true,
    head: {
      mode: 'attached',
      refName: 'main',
      commitId: result.head.id,
      refVersion: cloneRefVersion(result.head.refRevision),
    },
    diagnostics: [],
  };
}

export async function readGraphRef(
  graph: VersionGraphStore,
  refName: RefName,
): Promise<GetRefResult> {
  if (refName !== MATERIALIZATION_MAIN_REF_NAME) {
    return { ok: true, ref: null, diagnostics: [] };
  }

  const result = await graph.readRef(VERSION_GRAPH_MAIN_REF);
  if (result.status !== 'success' || result.ref.name !== VERSION_GRAPH_MAIN_REF) {
    return {
      ok: false,
      error: {
        code: 'versionCapabilityDisabled',
        message: 'Version graph ref could not be read.',
      },
      diagnostics: refDiagnostics(
        'VERSION_CHECKOUT_REF_READ_FAILED',
        'Version graph ref could not be read.',
        result.diagnostics,
      ),
    };
  }

  return {
    ok: true,
    ref: liveRefFromGraphRef(graph.namespace, result.ref),
    diagnostics: [],
  };
}

function liveRefFromGraphRef(
  namespace: VersionGraphNamespace,
  ref: VersionGraphRef,
): LiveRefRecord {
  const refVersion = cloneRefVersion(ref.revision);
  return Object.freeze({
    state: 'live',
    schemaVersion: 1,
    versionDocumentId: namespace.documentId,
    name: MATERIALIZATION_MAIN_REF_NAME,
    kind: 'branch',
    targetCommitId: ref.commitId,
    providerRefId: `graph-ref:${namespace.graphId}:main`,
    providerEpoch: refVersion,
    refIncarnationId: `ref-incarnation:${namespace.graphId}:main`,
    protected: true,
    createdAt: ref.updatedAt,
    createdBy: MATERIALIZATION_REF_AUTHOR,
    updatedAt: ref.updatedAt,
    updatedBy: MATERIALIZATION_REF_AUTHOR,
    refVersion,
  });
}

function checkoutDiagnostics(
  code: CheckoutMaterializationDiagnostic['code'],
  message: string,
  sourceDiagnostics: readonly { readonly code: string }[],
): readonly CheckoutMaterializationDiagnostic[] {
  return [
    Object.freeze({
      code,
      severity: 'error',
      message,
      details: { cause: sourceDiagnostics[0]?.code ?? 'unknown' },
    }),
  ];
}

function refDiagnostics(
  code: string,
  message: string,
  sourceDiagnostics: readonly { readonly code: string }[],
): readonly VersionDiagnostic[] {
  return [
    {
      code,
      severity: 'error',
      message,
      details: { cause: sourceDiagnostics[0]?.code ?? 'unknown' },
    },
  ];
}
