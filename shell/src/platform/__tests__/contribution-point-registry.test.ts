import { ContributionPointRegistry } from '../contribution-point-registry';
import type {
  ContributionDeclaration,
  ContributionPointId,
  ContributionPointRegistration,
} from '../types';

function makePointRegistration(
  overrides: Partial<ContributionPointRegistration> = {},
): ContributionPointRegistration {
  return {
    id: 'custom.point' as ContributionPointId,
    kind: 'command',
    description: 'A custom point',
    stability: 'stable',
    overridePolicy: 'reject',
    allowedContributorKinds: ['any'],
    schemaVersion: 1,
    ...overrides,
  };
}

function makeDeclaration(
  overrides: Partial<ContributionDeclaration> = {},
): ContributionDeclaration {
  return {
    targetPointId: 'mog.commands' as ContributionPointId,
    contributorKind: 'app',
    schemaVersion: 1,
    priority: 0,
    metadata: {
      contributionId: 'test-contribution',
      label: 'Test',
    },
    ...overrides,
  };
}

describe('ContributionPointRegistry', () => {
  let registry: ContributionPointRegistry;

  beforeEach(() => {
    registry = new ContributionPointRegistry();
  });

  it('has built-in points after construction', () => {
    const points = registry.listPoints();
    const ids = points.map((p) => p.id);
    expect(ids).toContain('mog.commands');
    expect(ids).toContain('mog.main-menu');
    expect(ids).toContain('mog.context-menu');
    expect(ids).toContain('mog.toolbar');
    expect(ids).toContain('mog.command-palette');
    expect(ids).toContain('mog.navigation');
    expect(ids).toContain('mog.sidebar');
    expect(ids).toContain('mog.status-bar');
    expect(ids).toContain('mog.file-handlers');
    expect(ids).toContain('mog.settings-pages');
    expect(points.length).toBe(10);
  });

  it('registers a custom point', () => {
    const custom = makePointRegistration({ id: 'custom.test' as ContributionPointId });
    registry.registerPoint(custom);
    expect(registry.getPoint('custom.test' as ContributionPointId)).toBe(custom);
    expect(registry.listPoints().length).toBe(11);
  });

  it('throws on duplicate point ID', () => {
    expect(() =>
      registry.registerPoint(makePointRegistration({ id: 'mog.commands' as ContributionPointId })),
    ).toThrow('already registered');
  });

  it('validates contribution against existing point', () => {
    const result = registry.validateContribution(makeDeclaration());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates contribution against missing point fails', () => {
    const result = registry.validateContribution(
      makeDeclaration({ targetPointId: 'nonexistent.point' as ContributionPointId }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/does not exist/);
  });

  it('validates contribution with wrong contributor kind fails', () => {
    // Register a point that only allows 'shell'
    registry.registerPoint(
      makePointRegistration({
        id: 'restricted.point' as ContributionPointId,
        allowedContributorKinds: ['shell'],
      }),
    );

    const result = registry.validateContribution(
      makeDeclaration({
        targetPointId: 'restricted.point' as ContributionPointId,
        contributorKind: 'plugin',
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/not allowed/);
  });

  it('validates contribution with schema version mismatch fails', () => {
    const result = registry.validateContribution(makeDeclaration({ schemaVersion: 99 }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Schema version mismatch/);
  });

  it('lists points by kind', () => {
    const menuPoints = registry.listPointsByKind('menu');
    expect(menuPoints.length).toBe(2);
    expect(menuPoints.map((p) => p.id)).toContain('mog.main-menu');
    expect(menuPoints.map((p) => p.id)).toContain('mog.context-menu');

    const commandPoints = registry.listPointsByKind('command');
    expect(commandPoints.length).toBe(2);
    expect(commandPoints.map((p) => p.id)).toContain('mog.commands');
    expect(commandPoints.map((p) => p.id)).toContain('mog.command-palette');
  });
});
