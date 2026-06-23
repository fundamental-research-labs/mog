import { jest } from '@jest/globals';

import {
  commitProviderGraphChild,
  createProviderGraphFixture,
} from './version-refs-provider-fixtures';
import {
  createWorkbook,
  expectNoDiagnosticLeak,
  expectNoWriteFailure,
} from './version-refs-provider-test-utils';

export function registerProtectedRefProviderGuardScenarios(): void {
  it('rejects symbolic HEAD, immutable main, and tag-shaped refs before provider write attempts', async () => {
    const fixture = await createProviderGraphFixture();
    const { initialized, provider } = fixture;
    const child = await commitProviderGraphChild(fixture, 'immutable-target');
    const wb = createWorkbook({
      versioning: {
        provider,
      },
    });
    const readGraphRegistry = jest.spyOn(provider, 'readGraphRegistry');
    const openGraph = jest.spyOn(provider, 'openGraph');
    const tagRef = 'refs/tags/release-secret' as any;

    const protectedHeadCreate = await wb.version.createBranch({
      name: 'HEAD' as any,
      targetCommitId: initialized.rootCommit.id,
    });
    expectNoWriteFailure(protectedHeadCreate, 'VERSION_PERMISSION_DENIED');

    const protectedHeadAdvance = await wb.version.fastForwardBranch({
      name: 'HEAD' as any,
      nextCommitId: child.commit.id,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: initialized.initialHead.revision,
    });
    expectNoWriteFailure(protectedHeadAdvance, 'VERSION_PERMISSION_DENIED');

    const protectedHeadDelete = await wb.version.deleteBranch({
      name: 'HEAD' as any,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: initialized.initialHead.revision,
    });
    expectNoWriteFailure(protectedHeadDelete, 'VERSION_PERMISSION_DENIED');

    const protectedCreate = await wb.version.createBranch({
      name: 'refs/heads/main' as any,
      targetCommitId: initialized.rootCommit.id,
    });
    expectNoWriteFailure(protectedCreate, 'VERSION_PERMISSION_DENIED', {
      payload: expect.objectContaining({ refName: 'redacted' }),
    });

    const protectedAdvance = await wb.version.fastForwardBranch({
      name: 'main' as any,
      nextCommitId: child.commit.id,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: initialized.initialHead.revision,
    });
    expectNoWriteFailure(protectedAdvance, 'VERSION_PERMISSION_DENIED', {
      payload: expect.objectContaining({ refName: 'redacted' }),
    });

    const protectedDelete = await wb.version.deleteRef({
      name: 'refs/heads/main' as any,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: initialized.initialHead.revision,
    });
    expectNoWriteFailure(protectedDelete, 'VERSION_PERMISSION_DENIED', {
      payload: expect.objectContaining({ refName: 'redacted' }),
    });

    const protectedDeleteBranch = await wb.version.deleteBranch({
      name: 'main' as any,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: initialized.initialHead.revision,
    });
    expectNoWriteFailure(protectedDeleteBranch, 'VERSION_PERMISSION_DENIED', {
      payload: expect.objectContaining({ refName: 'redacted' }),
    });

    const tagCreate = await wb.version.createBranch({
      name: tagRef,
      targetCommitId: initialized.rootCommit.id,
    });
    expectNoWriteFailure(tagCreate, 'VERSION_INVALID_OPTIONS', {
      payload: expect.objectContaining({ refName: 'redacted' }),
    });
    expectNoDiagnosticLeak(tagCreate, 'refs/tags/release-secret', 'release-secret');

    const tagAdvance = await wb.version.fastForwardBranch({
      name: tagRef,
      nextCommitId: child.commit.id,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: initialized.initialHead.revision,
    });
    expectNoWriteFailure(tagAdvance, 'VERSION_INVALID_OPTIONS', {
      payload: expect.objectContaining({ refName: 'redacted' }),
    });
    expectNoDiagnosticLeak(tagAdvance, 'refs/tags/release-secret', 'release-secret');

    const tagDelete = await wb.version.deleteRef({
      name: tagRef,
      expectedHead: initialized.rootCommit.id,
      expectedRefRevision: initialized.initialHead.revision,
    });
    expectNoWriteFailure(tagDelete, 'VERSION_INVALID_OPTIONS', {
      payload: expect.objectContaining({ refName: 'redacted' }),
    });
    expectNoDiagnosticLeak(tagDelete, 'refs/tags/release-secret', 'release-secret');

    expect(readGraphRegistry).not.toHaveBeenCalled();
    expect(openGraph).not.toHaveBeenCalled();
  });
}
