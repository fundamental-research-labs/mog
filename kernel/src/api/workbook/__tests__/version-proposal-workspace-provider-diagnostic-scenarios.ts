import { expect, it } from '@jest/globals';

import {
  ACTOR,
  createProposalInput,
  graphWithRoot,
  unsafeStartDiagnosticWorkspaceService,
  versionForProvider,
} from './version-proposal-workspace-provider-fixtures';

export function registerProposalWorkspaceDiagnosticScenarios(): void {
  it('redacts unsafe provider workspace diagnostics before returning public failures', async () => {
    const graph = await graphWithRoot();
    const workspaceService = unsafeStartDiagnosticWorkspaceService();
    const version = versionForProvider(graph.provider, workspaceService);
    const created = await version.createProposal(
      createProposalInput('proposal-create-unsafe-diagnostics'),
    );
    if (!created.ok) throw new Error(`expected proposal create success: ${created.error.code}`);

    const opened = await version.startProposalWorkspace({
      clientRequestId: 'workspace-open-unsafe-diagnostics',
      proposalId: created.value.id,
      expectedRevision: 1,
      actor: ACTOR,
    });

    expect(opened).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.startProposalWorkspace',
        diagnostics: [
          expect.objectContaining({
            code: 'TEST_UNSAFE_WORKSPACE_DIAGNOSTIC',
            message: 'Workspace denied redacted-principal for redacted-principal.',
            data: expect.objectContaining({
              safeNote: 'redacted-principal',
              safeTokens: ['redacted-principal', 'redacted-principal'],
              nested: expect.objectContaining({
                safeStatus: 'kept',
                safeNote: 'redacted-principal',
              }),
            }),
          }),
        ],
      },
    });
    if (opened.ok) throw new Error('expected workspace start to fail');
    const diagnostic = opened.error.diagnostics[0] as any;
    expect(diagnostic.data).not.toHaveProperty('principalId');
    expect(diagnostic.data).not.toHaveProperty('agentRunId');
    expect(diagnostic.data).not.toHaveProperty('safeWorkspaceId');
    expect(diagnostic.data).not.toHaveProperty('workspaceId');
    expect(diagnostic.data).not.toHaveProperty('providerId');
    expect(diagnostic.data).not.toHaveProperty('providerIdentity');
    expect(diagnostic.data).not.toHaveProperty('workspace');
    expect(diagnostic.data.nested).not.toHaveProperty('actorId');
    const serialized = JSON.stringify(opened);
    expect(serialized).not.toContain('principal-secret');
    expect(serialized).not.toContain('agent-run-1');
    expect(serialized).not.toContain('actor-secret');
    expect(serialized).not.toContain('workspace:redaction');
    expect(serialized).not.toContain('workspace-secret');
    expect(serialized).not.toContain('provider-secret');
    expect(serialized).not.toContain('principalId');
    expect(serialized).not.toContain('agentRunId');
    expect(serialized).not.toContain('providerId');
    await expect(version.getProposal({ proposalId: created.value.id })).resolves.toMatchObject({
      ok: true,
      value: { status: 'draft', revision: 1 },
    });
  });
}
