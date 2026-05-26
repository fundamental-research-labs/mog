/**
 * Conformance tests — contribution resolution.
 */

import { PackageRegistryService } from '../../package-registry';
import { AppRegistryService } from '../../app-registry';
import { ContributionPointRegistry } from '../../contribution-point-registry';
import { ContributionResolver } from '../../contribution-resolver';
import { TASK_TRACKER_MANIFEST } from '@mog/app-task-tracker/src/manifest';
import { SPREADSHEET_CANONICAL_MANIFEST } from '@mog/app-spreadsheet/src/canonical-manifest';
import type {
  AppId,
  AppLoader,
  AppManifest,
  ContributionDeclaration,
  ContributionPointId,
} from '../../types';

const dummyLoader: AppLoader = () =>
  Promise.resolve({ default: (() => null) as unknown as React.ComponentType<never> });

function declarationFromManifestContribution(
  contribution: AppManifest['contributions'][number],
): ContributionDeclaration {
  return {
    targetPointId: contribution.contributionPointId as ContributionPointId,
    contributorKind: 'app',
    schemaVersion: 1,
    priority: 0,
    metadata: {
      contributionId: contribution.id,
      label: contribution.label ?? contribution.id,
      icon: contribution.icon,
    },
  };
}

function addManifestContributions(resolver: ContributionResolver, manifest: AppManifest): void {
  for (const contribution of manifest.contributions) {
    resolver.addContribution(
      String(manifest.id),
      declarationFromManifestContribution(contribution),
    );
  }
}

function buildResolverWithBothApps() {
  const packages = new PackageRegistryService();
  packages.registerBuiltInPackage(SPREADSHEET_CANONICAL_MANIFEST, dummyLoader);
  packages.registerBuiltInPackage(TASK_TRACKER_MANIFEST, dummyLoader);
  packages.enablePackage('spreadsheet' as AppId);
  packages.enablePackage('task-tracker' as AppId);

  const appRegistry = new AppRegistryService(packages);

  const pointRegistry = new ContributionPointRegistry();

  const resolver = new ContributionResolver(pointRegistry);
  for (const app of appRegistry.listApps()) {
    addManifestContributions(resolver, app.manifest);
  }

  return { packages, appRegistry, pointRegistry, resolver };
}

describe('Contribution Resolution', () => {
  it('spreadsheet and task-tracker both contribute to mog.navigation', () => {
    const { resolver } = buildResolverWithBothApps();
    const navContributions = resolver.resolve(
      'mog.navigation' as ContributionPointId,
    ).contributions;

    const appIds = navContributions.map((c) => c.sourceId);
    expect(appIds).toContain('spreadsheet');
    expect(appIds).toContain('task-tracker');
    expect(navContributions).toHaveLength(2);
  });

  it('contributions resolve in deterministic order', () => {
    const { resolver } = buildResolverWithBothApps();

    // Run resolution multiple times: order must be stable.
    const results1 = resolver.resolve('mog.navigation' as ContributionPointId).contributions;
    const results2 = resolver.resolve('mog.navigation' as ContributionPointId).contributions;

    expect(results1.map((r) => r.declaration.metadata.contributionId)).toEqual(
      results2.map((r) => r.declaration.metadata.contributionId),
    );

    expect(results1[0].sourceId).toBe(results2[0].sourceId);
    expect(results1[1].sourceId).toBe(results2[1].sourceId);
  });

  it('only enabled app manifests are submitted to the resolver', () => {
    const packages = new PackageRegistryService();
    packages.registerBuiltInPackage(SPREADSHEET_CANONICAL_MANIFEST, dummyLoader);
    packages.registerBuiltInPackage(TASK_TRACKER_MANIFEST, dummyLoader);
    packages.enablePackage('spreadsheet' as AppId);

    const appRegistry = new AppRegistryService(packages);
    const resolver = new ContributionResolver(new ContributionPointRegistry());
    for (const app of appRegistry.listApps()) {
      addManifestContributions(resolver, app.manifest);
    }

    const result = resolver.resolve('mog.navigation' as ContributionPointId);
    expect(result.contributions.map((c) => c.sourceId)).toEqual(['spreadsheet']);
  });

  it('resolution does not import app entry code (structural test)', () => {
    const { resolver, appRegistry } = buildResolverWithBothApps();
    const spy = jest.spyOn(appRegistry, 'getLoader');

    resolver.resolve('mog.navigation' as ContributionPointId);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('unregistered contribution point returns empty array', () => {
    const { resolver } = buildResolverWithBothApps();
    const results = resolver.resolve('mog.nonexistent' as ContributionPointId);
    expect(results.contributions).toHaveLength(0);
  });
});
