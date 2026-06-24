import type {
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionRefName,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../../context';
import {
  VERSION_GRAPH_HEAD_REF,
  type VersionGraphRef,
  type VersionGraphSymbolicRef,
} from '../../../../../document/version-store/graph';
import type { VersionGraphStore } from '../../../../../document/version-store/provider-graph-store';
import { namespaceForRegistry } from '../../../../../document/version-store/registry';
import {
  mapProviderDiagnostics,
  missingRefRevisionDiagnostic,
  providerErrorDiagnostic,
  redactedRefPayload,
  refConflictDiagnostic,
  safePublicRefPayload,
} from './version-apply-merge-target-ref-diagnostics';
import { VERSION_MAIN_REF } from './version-apply-merge-target-ref-names';
import { getAttachedVersionStoreProvider } from './version-apply-merge-target-ref-provider';
import {
  isRecord,
  isVersionRecordRevision,
  revisionsEqual,
} from './version-apply-merge-target-ref-utils';

export type ApplyMergeTargetRefCasValidationResult =
  | { readonly ok: true; readonly checked: boolean }
  | {
      readonly ok: false;
      readonly kind: 'staleTargetHead' | 'blocked';
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export type ApplyMergeTargetRefCasValidationInput = {
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead: VersionCommitExpectedHead;
};

export async function validateApplyMergeTargetRefCasProof(
  ctx: DocumentContext,
  input: ApplyMergeTargetRefCasValidationInput,
): Promise<ApplyMergeTargetRefCasValidationResult> {
  const provider = getAttachedVersionStoreProvider(ctx);
  if (!provider) return { ok: true, checked: false };

  try {
    const expectedRevisionDiagnostics = expectedTargetHeadRevisionDiagnostics(input);
    if (expectedRevisionDiagnostics.length > 0) {
      return { ok: false, kind: 'blocked', diagnostics: expectedRevisionDiagnostics };
    }

    const registry = await provider.readGraphRegistry();
    if (registry.status !== 'ok') {
      return {
        ok: false,
        kind: 'blocked',
        diagnostics: mapProviderDiagnostics(registry.diagnostics),
      };
    }

    const graph = await provider.openGraph(
      namespaceForRegistry(registry.registry),
      provider.accessContext,
    );
    return validateApplyMergeTargetRefCasProofForGraph(graph, input);
  } catch {
    return { ok: false, kind: 'blocked', diagnostics: [providerErrorDiagnostic()] };
  }
}

export async function validateApplyMergeTargetRefCasProofForGraph(
  graph: VersionGraphStore,
  input: ApplyMergeTargetRefCasValidationInput,
): Promise<ApplyMergeTargetRefCasValidationResult> {
  try {
    const expectedRevisionDiagnostics = expectedTargetHeadRevisionDiagnostics(input);
    if (expectedRevisionDiagnostics.length > 0) {
      return { ok: false, kind: 'blocked', diagnostics: expectedRevisionDiagnostics };
    }

    const target = await readTargetRef(graph, input.targetRef);
    if (!target.ok) return { ok: false, kind: 'blocked', diagnostics: target.diagnostics };

    const staleTarget = staleTargetHeadDiagnostics(target.ref, input);
    if (staleTarget.length > 0) {
      return { ok: false, kind: 'staleTargetHead', diagnostics: staleTarget };
    }

    if (shouldReadSymbolicHead(input)) {
      const symbolic = await readSymbolicHead(graph);
      if (!symbolic.ok) return { ok: false, kind: 'blocked', diagnostics: symbolic.diagnostics };

      const symbolicDiagnostics = symbolicHeadDiagnostics(symbolic.head, input);
      if (symbolicDiagnostics.length > 0) {
        return { ok: false, kind: 'blocked', diagnostics: symbolicDiagnostics };
      }
    }

    return { ok: true, checked: true };
  } catch {
    return { ok: false, kind: 'blocked', diagnostics: [providerErrorDiagnostic()] };
  }
}

async function readTargetRef(
  graph: VersionGraphStore,
  targetRef: VersionMainRefName | VersionRefName,
): Promise<
  | { readonly ok: true; readonly ref: VersionGraphRef }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  const read = await graph.readRef(targetRef);
  if (read.status !== 'success' || !read.ref) {
    return { ok: false, diagnostics: mapProviderDiagnostics(read.diagnostics) };
  }
  if (read.ref.name === VERSION_GRAPH_HEAD_REF) {
    return {
      ok: false,
      diagnostics: [
        refConflictDiagnostic(
          'The provider resolved applyMerge targetRef to a symbolic ref.',
          {
            reason: 'symbolicTargetRefResolved',
            expectedTargetRef: safePublicRefPayload(targetRef),
            actualTargetRef: redactedRefPayload(read.ref.name),
          },
          'no-write-attempted',
        ),
      ],
    };
  }
  if (read.ref.name !== targetRef) {
    return {
      ok: false,
      diagnostics: [
        refConflictDiagnostic(
          'The current target ref does not match applyMerge targetRef.',
          {
            reason: 'targetRefMismatch',
            expectedTargetRef: safePublicRefPayload(targetRef),
            actualTargetRef: safePublicRefPayload(read.ref.name),
          },
          'no-write-attempted',
        ),
      ],
    };
  }
  if (!isVersionRecordRevision(read.ref.revision)) {
    return {
      ok: false,
      diagnostics: [missingRefRevisionDiagnostic('missingTargetRefRevision', targetRef)],
    };
  }
  return { ok: true, ref: read.ref };
}

async function readSymbolicHead(
  graph: VersionGraphStore,
): Promise<
  | { readonly ok: true; readonly head: VersionGraphSymbolicRef }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  const read = await graph.readRef(VERSION_GRAPH_HEAD_REF);
  if (read.status !== 'success' || !read.ref) {
    return { ok: false, diagnostics: mapProviderDiagnostics(read.diagnostics) };
  }
  if (read.ref.name !== VERSION_GRAPH_HEAD_REF) {
    return {
      ok: false,
      diagnostics: [
        refConflictDiagnostic(
          'The provider did not resolve symbolic HEAD consistently.',
          {
            reason: 'symbolicHeadRefMismatch',
            expectedTargetRef: redactedRefPayload(VERSION_GRAPH_HEAD_REF),
            actualTargetRef: safePublicRefPayload(read.ref.name),
          },
          'no-write-attempted',
        ),
      ],
    };
  }
  if (!isVersionRecordRevision(read.ref.revision)) {
    return {
      ok: false,
      diagnostics: [missingRefRevisionDiagnostic('missingSymbolicHeadRevision')],
    };
  }
  return { ok: true, head: read.ref };
}

function shouldReadSymbolicHead(input: ApplyMergeTargetRefCasValidationInput): boolean {
  return (
    input.targetRef === VERSION_MAIN_REF ||
    input.expectedTargetHead.symbolicHeadRevision !== undefined
  );
}

function expectedTargetHeadRevisionDiagnostics(
  input: ApplyMergeTargetRefCasValidationInput,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  const expectedTargetHead = input.expectedTargetHead as unknown;
  if (!isRecord(expectedTargetHead)) {
    diagnostics.push(
      missingRefRevisionDiagnostic('missingExpectedTargetRefRevision', input.targetRef),
    );
    return diagnostics;
  }
  if (!isVersionRecordRevision(expectedTargetHead.revision)) {
    diagnostics.push(
      missingRefRevisionDiagnostic('missingExpectedTargetRefRevision', input.targetRef),
    );
  }
  const symbolicRevision = expectedTargetHead.symbolicHeadRevision;
  if (symbolicRevision !== undefined && !isVersionRecordRevision(symbolicRevision)) {
    diagnostics.push(missingRefRevisionDiagnostic('missingExpectedSymbolicHeadRevision'));
  }
  return diagnostics;
}

function staleTargetHeadDiagnostics(
  ref: VersionGraphRef,
  input: ApplyMergeTargetRefCasValidationInput,
): readonly VersionStoreDiagnostic[] {
  if (
    ref.commitId === input.expectedTargetHead.commitId &&
    revisionsEqual(ref.revision, input.expectedTargetHead.revision)
  ) {
    return [];
  }

  return [
    refConflictDiagnostic(
      'The target ref head no longer matches expectedTargetHead.',
      {
        reason: 'staleTargetHead',
        targetRef: safePublicRefPayload(input.targetRef),
        expectedHead: input.expectedTargetHead.commitId,
        actualHead: ref.commitId,
        expectedRevisionKind: input.expectedTargetHead.revision.kind,
        expectedRevision: input.expectedTargetHead.revision.value,
        actualRevisionKind: ref.revision.kind,
        actualRevision: ref.revision.value,
      },
      'ref-not-mutated',
    ),
  ];
}

function symbolicHeadDiagnostics(
  head: VersionGraphSymbolicRef,
  input: ApplyMergeTargetRefCasValidationInput,
): readonly VersionStoreDiagnostic[] {
  if (head.target !== input.targetRef) {
    return [
      refConflictDiagnostic(
        'The current symbolic HEAD target does not match applyMerge targetRef.',
        {
          reason: 'symbolicTargetMismatch',
          expectedTargetRef: safePublicRefPayload(input.targetRef),
          actualTargetRef: safePublicRefPayload(head.target),
        },
        'no-write-attempted',
      ),
    ];
  }

  const expectedRevision = input.expectedTargetHead.symbolicHeadRevision;
  if (expectedRevision && !revisionsEqual(head.revision, expectedRevision)) {
    return [
      refConflictDiagnostic(
        'The symbolic HEAD revision no longer matches expectedTargetHead.',
        {
          reason: 'staleSymbolicHead',
          targetRef: safePublicRefPayload(input.targetRef),
          expectedRevisionKind: expectedRevision.kind,
          expectedRevision: expectedRevision.value,
          actualRevisionKind: head.revision.kind,
          actualRevision: head.revision.value,
        },
        'no-write-attempted',
      ),
    ];
  }

  return [];
}
