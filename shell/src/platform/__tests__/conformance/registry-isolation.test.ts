/**
 * Conformance tests — registry isolation.
 */

import { PackageRegistryService } from '../../package-registry';
import { TASK_TRACKER_MANIFEST } from '@mog/app-task-tracker/src/manifest';
import type { AppId, AppLoader } from '../../types';

const dummyLoader: AppLoader = () =>
  Promise.resolve({ default: (() => null) as unknown as React.ComponentType<never> });

describe('Registry Isolation', () => {
  it('two PackageRegistryService instances do not share state', () => {
    const registryA = new PackageRegistryService();
    const registryB = new PackageRegistryService();

    registryA.registerBuiltInPackage(TASK_TRACKER_MANIFEST, dummyLoader);

    expect(registryA.getPackage('task-tracker')).toBeDefined();
    expect(registryB.getPackage('task-tracker')).toBeUndefined();
  });

  it('register in one, query from other returns undefined', () => {
    const registryA = new PackageRegistryService();
    const registryB = new PackageRegistryService();

    registryA.registerBuiltInPackage(TASK_TRACKER_MANIFEST, dummyLoader);

    expect(registryA.getPackage('task-tracker')).toBeDefined();
    expect(registryB.getPackage('task-tracker')).toBeUndefined();
  });

  it('each has independent enable/disable state', () => {
    const registryA = new PackageRegistryService();
    const registryB = new PackageRegistryService();

    registryA.registerBuiltInPackage(TASK_TRACKER_MANIFEST, dummyLoader);
    registryB.registerBuiltInPackage(TASK_TRACKER_MANIFEST, dummyLoader);

    registryA.enablePackage('task-tracker' as AppId);

    expect(registryA.getPackageState('task-tracker')).toBe('enabled');
    expect(registryB.getPackageState('task-tracker')).toBe('installed');
  });
});
