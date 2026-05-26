/**
 * Conformance tests — full app lifecycle end-to-end.
 */

import { PackageRegistryService } from '../../package-registry';
import { AppRegistryService } from '../../app-registry';
import { AppInstanceManager } from '../../app-instance-manager';
import { TASK_TRACKER_MANIFEST } from '@mog/app-task-tracker/src/manifest';
import { SPREADSHEET_CANONICAL_MANIFEST } from '@mog/app-spreadsheet/src/canonical-manifest';
import type { AppId, AppLoader, RouteSnapshot } from '../../types';

const dummyLoader: AppLoader = () =>
  Promise.resolve({ default: (() => null) as unknown as React.ComponentType<never> });

const workbookRoute: RouteSnapshot = { kind: 'resource', path: '/workbook/doc-1' };
const tasksRoute: RouteSnapshot = { kind: 'workspace', path: '/tasks' };

describe('App Lifecycle E2E', () => {
  it('full lifecycle: register, enable, launch, suspend, resume, close', async () => {
    // 1. Create PackageRegistryService
    const packages = new PackageRegistryService();

    // 2. Register spreadsheet and task-tracker as built-in packages
    packages.registerBuiltInPackage(SPREADSHEET_CANONICAL_MANIFEST, dummyLoader);
    packages.registerBuiltInPackage(TASK_TRACKER_MANIFEST, dummyLoader);

    // 3. Enable both
    packages.enablePackage('spreadsheet' as AppId);
    packages.enablePackage('task-tracker' as AppId);

    // 4. Create AppRegistryService view
    const appRegistry = new AppRegistryService(packages);
    expect(appRegistry.listApps()).toHaveLength(2);

    // 5. Create AppInstanceManager
    const instanceManager = new AppInstanceManager(appRegistry);

    // 6. Launch spreadsheet instance with workbook route
    const spreadsheetInstanceId = instanceManager.createInstance(
      'spreadsheet' as AppId,
      workbookRoute,
    );
    const spreadsheetLaunch = await instanceManager.launchInstance(spreadsheetInstanceId);
    expect(spreadsheetLaunch.success).toBe(true);

    // 7. Launch task-tracker instance with tasks route
    const taskTrackerInstanceId = instanceManager.createInstance(
      'task-tracker' as AppId,
      tasksRoute,
    );
    const taskTrackerLaunch = await instanceManager.launchInstance(taskTrackerInstanceId);
    expect(taskTrackerLaunch.success).toBe(true);

    // 8. Verify both running
    expect(instanceManager.getInstance(spreadsheetInstanceId)?.state).toBe('running');
    expect(instanceManager.getInstance(taskTrackerInstanceId)?.state).toBe('running');
    expect(
      instanceManager.listInstances().filter((instance) => instance.state === 'running'),
    ).toHaveLength(2);

    // 9. Suspend task-tracker
    instanceManager.suspendInstance(taskTrackerInstanceId);
    expect(instanceManager.getInstance(taskTrackerInstanceId)?.state).toBe('suspended');
    expect(
      instanceManager.listInstances().filter((instance) => instance.state === 'running'),
    ).toHaveLength(1);

    // 10. Resume task-tracker
    instanceManager.resumeInstance(taskTrackerInstanceId);
    expect(instanceManager.getInstance(taskTrackerInstanceId)?.state).toBe('running');
    expect(
      instanceManager.listInstances().filter((instance) => instance.state === 'running'),
    ).toHaveLength(2);

    // 11. Close both
    instanceManager.closeInstance(spreadsheetInstanceId);
    instanceManager.closeInstance(taskTrackerInstanceId);

    // 12. Verify all instances closed
    expect(instanceManager.getInstance(spreadsheetInstanceId)?.state).toBe('closed');
    expect(instanceManager.getInstance(taskTrackerInstanceId)?.state).toBe('closed');
    expect(
      instanceManager.listInstances().filter((instance) => instance.state === 'running'),
    ).toHaveLength(0);
    expect(instanceManager.listInstances()).toHaveLength(2);
  });

  it('launching a disabled app is denied', async () => {
    const packages = new PackageRegistryService();
    packages.registerBuiltInPackage(TASK_TRACKER_MANIFEST, dummyLoader);
    // Not enabled!

    const appRegistry = new AppRegistryService(packages);
    const instanceManager = new AppInstanceManager(appRegistry);
    const instanceId = instanceManager.createInstance('task-tracker' as AppId, tasksRoute);

    const result = await instanceManager.launchInstance(instanceId);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toBe("App 'task-tracker' is not registered or not enabled");
    }
    expect(instanceManager.getInstance(instanceId)?.state).toBe('launchDenied');
  });

  it('cannot suspend an already-suspended instance', async () => {
    const packages = new PackageRegistryService();
    packages.registerBuiltInPackage(TASK_TRACKER_MANIFEST, dummyLoader);
    packages.enablePackage('task-tracker' as AppId);

    const appRegistry = new AppRegistryService(packages);
    const instanceManager = new AppInstanceManager(appRegistry);

    const instanceId = instanceManager.createInstance('task-tracker' as AppId, tasksRoute);
    await instanceManager.launchInstance(instanceId);
    instanceManager.suspendInstance(instanceId);

    expect(() => instanceManager.suspendInstance(instanceId)).toThrow('Invalid state transition');
  });

  it('cannot resume a running instance', async () => {
    const packages = new PackageRegistryService();
    packages.registerBuiltInPackage(TASK_TRACKER_MANIFEST, dummyLoader);
    packages.enablePackage('task-tracker' as AppId);

    const appRegistry = new AppRegistryService(packages);
    const instanceManager = new AppInstanceManager(appRegistry);

    const instanceId = instanceManager.createInstance('task-tracker' as AppId, tasksRoute);
    await instanceManager.launchInstance(instanceId);

    expect(() => instanceManager.resumeInstance(instanceId)).toThrow('Invalid state transition');
  });
});
