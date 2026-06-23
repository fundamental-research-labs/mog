import { WorkbookVersionImpl } from '../version';
import { mergeResultIdForPreviewDigest } from '../../../document/version-store/merge-attempt-artifacts';
import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import {
  documentScopeForGraph,
  expectInitializeSuccess,
  initializeInput,
} from './version-merge-review-endpoints-helpers-context';

export function expectNoDiagnosticLeaks(value: unknown, canaries: readonly string[]): void {
  const serialized = JSON.stringify(value);
  for (const canary of canaries) expect(serialized).not.toContain(canary);
}

// prettier-ignore
export function expectPublicDiagnostic(value: unknown, operation: string, code: string, message?: string): void {
  const diagnostic = { code, ...(message ? { message } : {}), data: expect.objectContaining({ redacted: true, payload: expect.objectContaining({ operation }) }) };
  expect(value).toMatchObject({ ok: false, error: { diagnostics: [expect.objectContaining(diagnostic)] } });
}

// prettier-ignore
export async function accessDeniedPreviewArtifactResult() {
  const graphId = 'access-denied-preview-artifact', documentScope = documentScopeForGraph(graphId);
  const baseProvider = createInMemoryVersionStoreProvider({ documentScope });
  expectInitializeSuccess(await baseProvider.initializeGraph(await initializeInput(graphId, 'root', documentScope)));
  const digest = { algorithm: 'sha256', digest: '8'.repeat(64) } as const, rawCommitId = `commit:sha256:${'7'.repeat(64)}`;
  const provider = { readGraphRegistry: () => baseProvider.readGraphRegistry(), openGraph: async () => ({ getObjectRecord: async () => {
    throw Object.assign(new Error(rawCommitId), { diagnostics: [{ issueCode: 'VERSION_PERMISSION_DENIED', safeMessage: `Cannot read ${rawCommitId} or sha256:${digest.digest}.` }] });
  } }) };
  const version = new WorkbookVersionImpl({ versioning: { provider } } as any);
  const result = await version.getMergeConflictDetail({ resultId: mergeResultIdForPreviewDigest(digest), resultDigest: digest, redactionPolicyDigest: digest, conflictId: 'conflict:legacy:access-denied', expectedConflictDigest: { algorithm: 'sha256', digest: '9'.repeat(64) }, valueRole: 'base', purpose: 'review' });
  return { result, canaries: [rawCommitId, digest.digest, `sha256:${digest.digest}`, `merge-result:${digest.digest}`] };
}
