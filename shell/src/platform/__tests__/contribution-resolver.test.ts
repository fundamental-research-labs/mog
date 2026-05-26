import { ContributionPointRegistry } from '../contribution-point-registry';
import { ContributionResolver } from '../contribution-resolver';
import type { ContributionDeclaration, ContributionPointId } from '../types';

function makeDecl(
  overrides: Partial<ContributionDeclaration> & {
    contributionId?: string;
    label?: string;
  } = {},
): ContributionDeclaration {
  const { contributionId, label, ...rest } = overrides;
  return {
    targetPointId: 'mog.commands' as ContributionPointId,
    contributorKind: 'app',
    schemaVersion: 1,
    priority: 0,
    metadata: {
      contributionId: contributionId ?? 'cmd-1',
      label: label ?? 'Command 1',
    },
    ...rest,
  };
}

describe('ContributionResolver', () => {
  let registry: ContributionPointRegistry;
  let resolver: ContributionResolver;

  beforeEach(() => {
    registry = new ContributionPointRegistry();
    resolver = new ContributionResolver(registry);
  });

  it('resolves contributions from two sources in deterministic order', () => {
    resolver.addContribution('app-b', makeDecl({ contributionId: 'cmd-b', priority: 10 }));
    resolver.addContribution('app-a', makeDecl({ contributionId: 'cmd-a', priority: 20 }));

    const result = resolver.resolve('mog.commands' as ContributionPointId);
    expect(result.contributions.length).toBe(2);
    // Higher priority first
    expect(result.contributions[0].declaration.metadata.contributionId).toBe('cmd-a');
    expect(result.contributions[1].declaration.metadata.contributionId).toBe('cmd-b');
    expect(result.conflicts).toHaveLength(0);
  });

  it('same priority uses stable sort by source ID then contribution ID', () => {
    resolver.addContribution('app-b', makeDecl({ contributionId: 'cmd-z', priority: 5 }));
    resolver.addContribution('app-a', makeDecl({ contributionId: 'cmd-y', priority: 5 }));
    resolver.addContribution('app-a', makeDecl({ contributionId: 'cmd-x', priority: 5 }));

    const result = resolver.resolve('mog.commands' as ContributionPointId);
    const ids = result.contributions.map((c) => c.declaration.metadata.contributionId);
    // Same priority -> sourceId asc (app-a before app-b)
    // Within app-a -> contributionId asc (cmd-x before cmd-y)
    expect(ids).toEqual(['cmd-x', 'cmd-y', 'cmd-z']);
  });

  it('detects duplicate ID as conflict', () => {
    resolver.addContribution('app-a', makeDecl({ contributionId: 'dup' }));
    resolver.addContribution('app-b', makeDecl({ contributionId: 'dup' }));

    const result = resolver.resolve('mog.commands' as ContributionPointId);
    expect(result.conflicts.length).toBe(1);
    expect(result.conflicts[0].kind).toBe('duplicate-id');
    expect(result.conflicts[0].message).toMatch(/dup/);
  });

  it('removes contributions from a source and re-resolves', () => {
    resolver.addContribution('app-a', makeDecl({ contributionId: 'cmd-a' }));
    resolver.addContribution('app-b', makeDecl({ contributionId: 'cmd-b' }));

    resolver.removeContributions('app-a');

    const result = resolver.resolve('mog.commands' as ContributionPointId);
    expect(result.contributions.length).toBe(1);
    expect(result.contributions[0].sourceId).toBe('app-b');
  });

  it('override policy "reject" blocks duplicates', () => {
    // mog.commands has overridePolicy: 'reject'
    resolver.addContribution('app-a', makeDecl({ contributionId: 'dup' }));
    resolver.addContribution('app-b', makeDecl({ contributionId: 'dup' }));

    const result = resolver.resolve('mog.commands' as ContributionPointId);
    // Duplicates are excluded under 'reject'
    expect(result.contributions.length).toBe(0);
    expect(result.conflicts.length).toBe(1);
  });

  it('override policy "last-wins" allows duplicates keeping highest priority', () => {
    // mog.file-handlers has overridePolicy: 'last-wins'
    resolver.addContribution(
      'app-a',
      makeDecl({
        targetPointId: 'mog.file-handlers' as ContributionPointId,
        contributionId: 'handler-csv',
        priority: 5,
      }),
    );
    resolver.addContribution(
      'app-b',
      makeDecl({
        targetPointId: 'mog.file-handlers' as ContributionPointId,
        contributionId: 'handler-csv',
        priority: 10,
      }),
    );

    const result = resolver.resolve('mog.file-handlers' as ContributionPointId);
    // last-wins keeps the first occurrence after sort (highest priority)
    expect(result.contributions.length).toBe(1);
    expect(result.contributions[0].sourceId).toBe('app-b');
    // Still reports the conflict
    expect(result.conflicts.length).toBe(1);
  });

  it('resolution is synchronous and pure (never imports code)', () => {
    resolver.addContribution('app-a', makeDecl({ contributionId: 'cmd-a' }));

    // resolve() returns synchronously — no Promise, no dynamic import
    const result = resolver.resolve('mog.commands' as ContributionPointId);
    expect(result).toBeDefined();
    expect(result.pointId).toBe('mog.commands');
    // Structural guarantee: resolve is not async
    expect(result instanceof Promise).toBe(false);
  });

  it('resolveAll returns results for all points with contributions', () => {
    resolver.addContribution(
      'app-a',
      makeDecl({
        targetPointId: 'mog.commands' as ContributionPointId,
        contributionId: 'cmd-a',
      }),
    );
    resolver.addContribution(
      'app-a',
      makeDecl({
        targetPointId: 'mog.toolbar' as ContributionPointId,
        contributionId: 'tool-a',
      }),
    );

    const all = resolver.resolveAll();
    expect(all.size).toBe(2);
    expect(all.has('mog.commands' as ContributionPointId)).toBe(true);
    expect(all.has('mog.toolbar' as ContributionPointId)).toBe(true);
  });

  it('getContributionsBySource returns declarations for a source', () => {
    const decl = makeDecl({ contributionId: 'cmd-a' });
    resolver.addContribution('app-a', decl);

    const result = resolver.getContributionsBySource('app-a');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(decl);

    // Unknown source returns empty
    expect(resolver.getContributionsBySource('unknown')).toHaveLength(0);
  });
});
