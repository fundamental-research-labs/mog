import { parseWorkbookCommitParentIds } from './parents';
import type { WorkbookCommitPayload, WorkbookCommitStoreDiagnostic } from './types';
import { parseVersionAuthor } from './payload-author';
import { parseCommitAnnotation } from './payload-annotation';
import { parseCompletenessDiagnostics } from './payload-completeness';
import { diagnostic, invalidPayloadDiagnostic } from './payload-diagnostics';
import {
  parseOptionalDigest,
  parseOptionalDigestArray,
  parsePayloadDigest,
} from './payload-digests';
import { isPlainRecord } from './payload-guards';
import { parseString } from './payload-scalars';

export function parseCommitPayload(
  payload: unknown,
):
  | { readonly ok: true; readonly payload: WorkbookCommitPayload }
  | { readonly ok: false; readonly diagnostics: readonly WorkbookCommitStoreDiagnostic[] } {
  if (!isPlainRecord(payload) || payload.schemaVersion !== 1) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('VERSION_OBJECT_STORE_FAILURE', 'Commit payload schema is invalid.'),
      ],
    };
  }
  const unsupportedPayloadKey = Object.keys(payload).find(
    (key) =>
      ![
        'schemaVersion',
        'documentId',
        'parentCommitIds',
        'snapshotRootDigest',
        'semanticChangeSetDigest',
        'mutationSegmentDigests',
        'author',
        'createdAt',
        'annotation',
        'completenessDiagnostics',
        'redactionSummaryDigest',
        'verificationSummaryDigest',
        'resolvedMergeAttemptDigest',
      ].includes(key),
  );
  if (unsupportedPayloadKey !== undefined) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('VERSION_INVALID_COMMIT_PAYLOAD', 'Commit payload has an unsupported field.', {
          details: { path: unsupportedPayloadKey },
        }),
      ],
    };
  }
  if (typeof payload.documentId !== 'string') {
    return {
      ok: false,
      diagnostics: [diagnostic('VERSION_WRONG_DOCUMENT', 'Commit payload documentId is invalid.')],
    };
  }
  const parentResult = parseWorkbookCommitParentIds(payload.parentCommitIds);
  if (!parentResult.ok) return { ok: false, diagnostics: parentResult.diagnostics };

  const diagnostics: WorkbookCommitStoreDiagnostic[] = [];
  const parentCommitIds = parentResult.parentCommitIds;
  const snapshotRootDigest = parsePayloadDigest(
    payload.snapshotRootDigest,
    'snapshotRootDigest',
    diagnostics,
  );
  const semanticChangeSetDigest = parsePayloadDigest(
    payload.semanticChangeSetDigest,
    'semanticChangeSetDigest',
    diagnostics,
  );
  const mutationSegmentDigests = parseOptionalDigestArray(
    payload.mutationSegmentDigests,
    'mutationSegmentDigests',
    diagnostics,
  );
  const redactionSummaryDigest = parseOptionalDigest(
    payload.redactionSummaryDigest,
    'redactionSummaryDigest',
    diagnostics,
  );
  const verificationSummaryDigest = parseOptionalDigest(
    payload.verificationSummaryDigest,
    'verificationSummaryDigest',
    diagnostics,
  );
  const resolvedMergeAttemptDigest = parseOptionalDigest(
    payload.resolvedMergeAttemptDigest,
    'resolvedMergeAttemptDigest',
    diagnostics,
  );
  const author = parseVersionAuthor(payload.author, 'author', diagnostics);
  const createdAt = parseString(payload.createdAt, 'createdAt', diagnostics);
  const annotation = parseCommitAnnotation(payload.annotation, 'annotation', diagnostics);
  const completenessDiagnostics = parseCompletenessDiagnostics(
    payload.completenessDiagnostics,
    'completenessDiagnostics',
    diagnostics,
  );
  if (resolvedMergeAttemptDigest !== undefined && parentCommitIds.length !== 2) {
    diagnostics.push(
      invalidPayloadDiagnostic(
        'resolvedMergeAttemptDigest',
        'Resolved merge-attempt identity is valid only on two-parent merge commits.',
      ),
    );
  }

  if (
    diagnostics.length > 0 ||
    snapshotRootDigest === undefined ||
    semanticChangeSetDigest === undefined ||
    author === undefined ||
    createdAt === undefined ||
    completenessDiagnostics === undefined
  ) {
    return { ok: false, diagnostics };
  }

  return {
    ok: true,
    payload: {
      schemaVersion: 1,
      documentId: payload.documentId,
      parentCommitIds,
      snapshotRootDigest,
      semanticChangeSetDigest,
      ...(mutationSegmentDigests.length === 0 ? {} : { mutationSegmentDigests }),
      author,
      createdAt,
      ...(annotation ? { annotation } : {}),
      completenessDiagnostics,
      ...(redactionSummaryDigest === undefined ? {} : { redactionSummaryDigest }),
      ...(verificationSummaryDigest === undefined ? {} : { verificationSummaryDigest }),
      ...(resolvedMergeAttemptDigest === undefined ? {} : { resolvedMergeAttemptDigest }),
    },
  };
}
