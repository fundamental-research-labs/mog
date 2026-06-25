import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { type VersionGraphRef } from './graph';
import { graphRefNameFromRefName } from './graph/graph-store-refs';
import { type VersionGraphNamespace } from './object-store';
import type { VersionGraphStore, VersionStoreDiagnostic, VersionStoreProvider } from './provider';
import { VersionStoreProviderError } from './provider';
import { namespaceForRegistry } from './registry';
import type { LiveRefRecord, RefVersion, VersionDiagnostic } from './refs/ref-store';
import { REF_NAME_STORAGE_PREFIX, validateRefName, type RefName } from './refs/ref-name';
import {
  checkoutAccessDeniedDiagnosticDetails,
  hasCheckoutAccessDeniedDiagnostic,
} from './checkout-access-diagnostics';
import {
  createCheckoutMaterializationService,
  type CheckoutHeadReader,
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
  readonly checkoutHeadReaderFactory?: (
    fallbackHeadReader: CheckoutHeadReader,
  ) => CheckoutHeadReader;
}

const PROVIDER_REF_AUTHOR: VersionAuthor = Object.freeze({
  authorId: 'version-store',
  actorKind: 'system',
  displayName: 'Version Store',
});

export class ProviderBackedCheckoutMaterializationService {
  private readonly provider: VersionStoreProvider;
  private readonly snapshotMaterializer?: CheckoutSnapshotMaterializer;
  private readonly checkoutHeadReaderFactory?: (
    fallbackHeadReader: CheckoutHeadReader,
  ) => CheckoutHeadReader;

  constructor(options: ProviderBackedCheckoutMaterializationServiceOptions) {
    this.provider = options.provider;
    this.snapshotMaterializer = options.snapshotMaterializer;
    this.checkoutHeadReaderFactory = options.checkoutHeadReaderFactory;
  }

  async planCheckout(
    request: CheckoutMaterializationRequest,
  ): Promise<CheckoutMaterializationResult> {
    const opened = await this.openVisibleGraph();
    if (!opened.ok) return opened.result;
    return createGraphCheckoutService(
      opened.graph,
      this.snapshotMaterializer,
      this.checkoutHeadReaderFactory,
    ).planCheckout(request);
  }

  async checkout(request: CheckoutMaterializationRequest): Promise<CheckoutMaterializationResult> {
    const opened = await this.openVisibleGraph();
    if (!opened.ok) return opened.result;
    return createGraphCheckoutService(
      opened.graph,
      this.snapshotMaterializer,
      this.checkoutHeadReaderFactory,
    ).checkout(request);
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
  checkoutHeadReaderFactory?: (fallbackHeadReader: CheckoutHeadReader) => CheckoutHeadReader,
) {
  const fallbackHeadReader: CheckoutHeadReader = {
    readHead: () => readGraphHead(graph),
  };
  const headReader = checkoutHeadReaderFactory
    ? checkoutHeadReaderFactory(fallbackHeadReader)
    : fallbackHeadReader;

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
    headReader,
    refReader: {
      readRef: async (refName) => {
        const result = await graph.readRef(graphRefNameFromRefName(refName));
        if (result.status !== 'success') {
          if (result.ref === null && isMissingGraphRef(result.diagnostics)) {
            return { ok: true, ref: null, diagnostics: [] };
          }
          const denied = checkoutRefAccessDeniedDiagnostic(result.diagnostics);
          return {
            ok: false,
            error: {
              code: 'versionCapabilityDisabled',
              message: 'Version graph ref could not be read.',
            },
            diagnostics: denied
              ? [denied]
              : refDiagnostics(
                  'VERSION_CHECKOUT_REF_READ_FAILED',
                  'Version graph ref could not be read.',
                  result.diagnostics,
                ),
          };
        }
        if (result.ref.name === 'HEAD') {
          return {
            ok: false,
            error: {
              code: 'versionCapabilityDisabled',
              message: 'Version graph ref resolved to a symbolic ref.',
            },
            diagnostics: refDiagnostics(
              'VERSION_CHECKOUT_REF_READ_FAILED',
              'Version graph ref resolved to a symbolic ref.',
              [],
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
  const refName = parseProviderGraphRefName(ref.name);
  const refVersion = cloneRefVersion(ref.revision);
  return Object.freeze({
    state: 'live',
    schemaVersion: 1,
    versionDocumentId: namespace.documentId,
    name: refName,
    kind: 'branch',
    targetCommitId: ref.commitId,
    providerRefId: ref.providerRefId ?? `graph-ref:${namespace.graphId}:${refName}`,
    providerEpoch: ref.providerEpoch ?? refVersion,
    refIncarnationId: ref.refIncarnationId ?? `ref-incarnation:${namespace.graphId}:${refName}`,
    protected: ref.protected ?? refName === 'main',
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
  const accessDenied = checkoutAccessDeniedDiagnosticDetails(sourceDiagnostics);
  const diagnostics = [
    accessDenied
      ? diagnostic('VERSION_PERMISSION_DENIED', 'Checkout access is denied for this caller.', {
          sourceDiagnostics,
          details: accessDenied,
        })
      : diagnostic('VERSION_CHECKOUT_PROVIDER_ERROR', message, { sourceDiagnostics }),
  ];
  return {
    ok: false,
    error: Object.freeze({
      code: accessDenied ? 'checkoutAccessDenied' : 'checkoutProviderUnavailable',
      message,
      diagnostics,
    }),
    diagnostics,
    mutationGuarantee: 'no-workbook-mutation',
  };
}

function diagnosticsFromProviderError(error: unknown): readonly VersionStoreDiagnostic[] {
  if (error instanceof VersionStoreProviderError) return error.diagnostics;
  if (isRecord(error)) {
    if (Array.isArray(error.diagnostics)) {
      return error.diagnostics.filter(isRecord) as VersionStoreDiagnostic[];
    }
    if (isRecord(error.diagnostic)) {
      return [error.diagnostic as VersionStoreDiagnostic];
    }
  }
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

function checkoutRefAccessDeniedDiagnostic(
  sourceDiagnostics: readonly { readonly code: string; readonly details?: unknown }[],
): VersionDiagnostic | null {
  if (!hasCheckoutAccessDeniedDiagnostic(sourceDiagnostics)) return null;
  const details = checkoutAccessDeniedDiagnosticDetails(sourceDiagnostics);
  return {
    code: 'VERSION_PERMISSION_DENIED',
    severity: 'error',
    message: 'Version graph ref access is denied for this caller.',
    details: {
      cause: 'VERSION_PERMISSION_DENIED',
      ...(details?.accessCategory === undefined
        ? {}
        : { accessCategory: String(details.accessCategory) }),
    },
  };
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

function parseProviderGraphRefName(value: string): RefName {
  const branchName = value.startsWith(REF_NAME_STORAGE_PREFIX)
    ? value.slice(REF_NAME_STORAGE_PREFIX.length)
    : value;
  const parsed = validateRefName(branchName);
  if (!parsed.ok) {
    throw new Error('Provider graph returned an invalid branch ref name.');
  }
  return parsed.name;
}

function isMissingGraphRef(
  diagnostics: readonly {
    readonly code: string;
    readonly details?: Readonly<Record<string, string | number | boolean | null>>;
  }[],
): boolean {
  return diagnostics.some(
    (item) => item.code === 'VERSION_INVALID_OPTIONS' && item.details?.refMissing === true,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
