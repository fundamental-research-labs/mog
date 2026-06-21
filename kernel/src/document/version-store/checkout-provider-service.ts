import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  VERSION_GRAPH_MAIN_REF,
  type VersionGraphRef,
} from './graph-store';
import { type VersionGraphNamespace } from './object-store';
import type { VersionGraphStore, VersionStoreDiagnostic, VersionStoreProvider } from './provider';
import { VersionStoreProviderError } from './provider';
import { namespaceForRegistry } from './registry';
import type { LiveRefRecord, RefVersion, VersionDiagnostic } from './ref-store';
import { validateRefName, type RefName } from './ref-name';
import {
  createCheckoutMaterializationService,
  type CheckoutHeadReadResult,
  type CheckoutMaterializationDiagnostic,
  type CheckoutMaterializationDiagnosticCode,
  type CheckoutMaterializationRequest,
  type CheckoutMaterializationResult,
} from './checkout-service';
import type { CheckoutSnapshotMaterializer } from './checkout-apply';

export interface ProviderBackedCheckoutMaterializationServiceOptions {
  readonly provider: VersionStoreProvider;
  readonly snapshotMaterializer?: CheckoutSnapshotMaterializer;
}

const PROVIDER_REF_AUTHOR: VersionAuthor = Object.freeze({
  authorId: 'version-store',
  actorKind: 'system',
  displayName: 'Version Store',
});
const PROVIDER_MAIN_REF_NAME = parseProviderMainRefName();

export class ProviderBackedCheckoutMaterializationService {
  private readonly provider: VersionStoreProvider;
  private readonly snapshotMaterializer?: CheckoutSnapshotMaterializer;

  constructor(options: ProviderBackedCheckoutMaterializationServiceOptions) {
    this.provider = options.provider;
    this.snapshotMaterializer = options.snapshotMaterializer;
  }

  async planCheckout(
    request: CheckoutMaterializationRequest,
  ): Promise<CheckoutMaterializationResult> {
    const opened = await this.openVisibleGraph();
    if (!opened.ok) return opened.result;
    return createGraphCheckoutService(opened.graph, this.snapshotMaterializer).planCheckout(
      request,
    );
  }

  async checkout(request: CheckoutMaterializationRequest): Promise<CheckoutMaterializationResult> {
    const opened = await this.openVisibleGraph();
    if (!opened.ok) return opened.result;
    return createGraphCheckoutService(opened.graph, this.snapshotMaterializer).checkout(request);
  }

  private async openVisibleGraph(): Promise<
    | {
        readonly ok: true;
        readonly namespace: VersionGraphNamespace;
        readonly graph: VersionGraphStore;
      }
    | {
        readonly ok: false;
        readonly result: CheckoutMaterializationResult;
      }
  > {
    try {
      const registryRead = await this.provider.readGraphRegistry();
      if (registryRead.status !== 'ok') {
        return {
          ok: false,
          result: providerFailure('Visible version graph registry is unavailable.', [
            ...registryRead.diagnostics,
          ]),
        };
      }

      const namespace = namespaceForRegistry(registryRead.registry);
      return {
        ok: true,
        namespace,
        graph: await this.provider.openGraph(namespace, this.provider.accessContext),
      };
    } catch (error) {
      return {
        ok: false,
        result: providerFailure('Visible version graph could not be opened.', [
          ...diagnosticsFromProviderError(error),
        ]),
      };
    }
  }
}

export function createProviderBackedCheckoutMaterializationService(
  options: ProviderBackedCheckoutMaterializationServiceOptions,
): ProviderBackedCheckoutMaterializationService {
  return new ProviderBackedCheckoutMaterializationService(options);
}

function createGraphCheckoutService(
  graph: VersionGraphStore,
  snapshotMaterializer?: CheckoutSnapshotMaterializer,
) {
  return createCheckoutMaterializationService({
    commitReader: {
      readCommit: (commitId) => graph.readCommit(commitId),
    },
    dependencyReader: {
      hasDependency: (dependency) => graph.hasObject(dependency),
    },
    snapshotReader: {
      readSnapshotRoot: (dependency) => graph.getObjectRecord(dependency),
    },
    ...(snapshotMaterializer ? { snapshotMaterializer } : {}),
    headReader: {
      readHead: () => readGraphHead(graph),
    },
    refReader: {
      readRef: async (refName) => {
        if (refName !== 'main') {
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
      },
    },
  });
}

async function readGraphHead(graph: VersionGraphStore): Promise<CheckoutHeadReadResult> {
  const result = await graph.readHead();
  if (result.status !== 'success') {
    return {
      ok: false,
      diagnostics: graphDiagnostics(
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
      ...(result.head.refRevision === undefined ? {} : { refVersion: result.head.refRevision }),
    },
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
    name: PROVIDER_MAIN_REF_NAME,
    kind: 'branch',
    targetCommitId: ref.commitId,
    providerRefId: `graph-ref:${namespace.graphId}:main`,
    providerEpoch: refVersion,
    refIncarnationId: `ref-incarnation:${namespace.graphId}:main`,
    protected: true,
    createdAt: ref.updatedAt,
    createdBy: PROVIDER_REF_AUTHOR,
    updatedAt: ref.updatedAt,
    updatedBy: PROVIDER_REF_AUTHOR,
    refVersion,
  });
}

function providerFailure(
  message: string,
  sourceDiagnostics: readonly VersionStoreDiagnostic[],
): CheckoutMaterializationResult {
  const diagnostics = [
    diagnostic('VERSION_CHECKOUT_PROVIDER_ERROR', message, { sourceDiagnostics }),
  ];
  return {
    ok: false,
    error: Object.freeze({
      code: 'checkoutProviderUnavailable',
      message,
      diagnostics,
    }),
    diagnostics,
    mutationGuarantee: 'no-workbook-mutation',
  };
}

function diagnosticsFromProviderError(error: unknown): readonly VersionStoreDiagnostic[] {
  if (error instanceof VersionStoreProviderError) return error.diagnostics;
  return [];
}

function graphDiagnostics(
  code: CheckoutMaterializationDiagnosticCode,
  message: string,
  sourceDiagnostics: readonly { readonly code: string }[],
): readonly CheckoutMaterializationDiagnostic[] {
  return [
    diagnostic(code, message, {
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

function diagnostic(
  code: CheckoutMaterializationDiagnosticCode,
  message: string,
  options: Omit<CheckoutMaterializationDiagnostic, 'code' | 'severity' | 'message'> & {
    readonly severity?: CheckoutMaterializationDiagnostic['severity'];
  } = {},
): CheckoutMaterializationDiagnostic {
  const { severity = 'error', ...rest } = options;
  return Object.freeze({
    code,
    severity,
    message,
    ...rest,
  });
}

function cloneRefVersion(refVersion: RefVersion): RefVersion {
  return Object.freeze({ kind: refVersion.kind, value: refVersion.value });
}

function parseProviderMainRefName(): RefName {
  const parsed = validateRefName('main');
  if (!parsed.ok) {
    throw new Error('Internal provider main ref name is invalid.');
  }
  return parsed.name;
}
