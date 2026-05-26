import type { AppManifest, AppLoader, AppId, AppInstanceId, RouteSnapshot } from '../types';
import { PackageRegistryService } from '../package-registry';
import { AppRegistryService } from '../app-registry';
import { AppInstanceManager } from '../app-instance-manager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifest(overrides: Partial<AppManifest> & { id: string }): AppManifest {
  return {
    id: overrides.id,
    name: overrides.id,
    version: '1.0.0',
    description: 'Test app',
    author: 'Mog',
    icon: 'test-app',
    entry: { module: '@test/app', export: 'default' },
    kind: 'utility-app',
    compatibility: [{ profile: 'mog.app-platform/v1', versionRange: '>=0.1.0' }],
    capabilities: ['services:basic'],
    routes: [{ path: '/test' }],
    data: {},
    contributions: [],
    lifecycle: { suspendable: true },
    runtimeHost: 'same-realm-first-party',
    ...overrides,
  };
}

const dummyLoader: AppLoader = () =>
  Promise.resolve({ default: (() => null) as unknown as React.ComponentType<never> });

const workspaceRoute: RouteSnapshot = { kind: 'workspace', path: '/' };
const resourceRoute: RouteSnapshot = {
  kind: 'resource',
  path: '/documents/abc',
  params: { documentId: 'abc' },
};

function setup() {
  const packageRegistry = new PackageRegistryService();
  const appRegistry = new AppRegistryService(packageRegistry);
  const instanceManager = new AppInstanceManager(appRegistry);

  // Register and enable a test app
  packageRegistry.registerBuiltInPackage(makeManifest({ id: 'test-app' }), dummyLoader);
  packageRegistry.enablePackage('test-app');

  return { packageRegistry, appRegistry, instanceManager };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AppInstanceManager', () => {
  it('creates and launches an instance, verify running state', async () => {
    const { instanceManager } = setup();

    const instanceId = instanceManager.createInstance('test-app' as AppId, workspaceRoute);
    expect(instanceManager.getInstance(instanceId)?.state).toBe('created');

    const result = await instanceManager.launchInstance(instanceId);
    expect(result.success).toBe(true);
    expect(instanceManager.getInstance(instanceId)?.state).toBe('running');
  });

  it('creates two instances of the same app with different routes', async () => {
    const { instanceManager } = setup();

    const id1 = instanceManager.createInstance('test-app' as AppId, workspaceRoute);
    const id2 = instanceManager.createInstance('test-app' as AppId, resourceRoute);

    await instanceManager.launchInstance(id1);
    await instanceManager.launchInstance(id2);

    const instances = instanceManager.getInstancesByApp('test-app' as AppId);
    expect(instances).toHaveLength(2);

    const inst1 = instanceManager.getInstance(id1);
    const inst2 = instanceManager.getInstance(id2);
    expect(inst1!.route.path).toBe('/');
    expect(inst2!.route.path).toBe('/documents/abc');
    expect(inst1!.instanceId).not.toBe(inst2!.instanceId);
  });

  it('suspend/resume cycle', async () => {
    const { instanceManager } = setup();

    const id = instanceManager.createInstance('test-app' as AppId, workspaceRoute);
    await instanceManager.launchInstance(id);
    expect(instanceManager.getInstance(id)?.state).toBe('running');

    instanceManager.suspendInstance(id);
    expect(instanceManager.getInstance(id)?.state).toBe('suspended');

    instanceManager.resumeInstance(id);
    expect(instanceManager.getInstance(id)?.state).toBe('running');
  });

  it('close disposes the instance', async () => {
    const { instanceManager } = setup();

    const id = instanceManager.createInstance('test-app' as AppId, workspaceRoute);
    await instanceManager.launchInstance(id);
    instanceManager.setActiveInstance(id);
    expect(instanceManager.getActiveInstance()).toBe(id);

    instanceManager.closeInstance(id);
    expect(instanceManager.getInstance(id)?.state).toBe('closed');
    expect(instanceManager.getActiveInstance()).toBeUndefined();
  });

  it('blocked launch for unregistered/disabled app', async () => {
    const { instanceManager } = setup();

    const id = instanceManager.createInstance('unknown-app' as AppId, workspaceRoute);
    const result = await instanceManager.launchInstance(id);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('incompatible');
    }
    expect(instanceManager.getInstance(id)?.state).toBe('launchDenied');
  });

  it('state change callback fires', async () => {
    const { instanceManager } = setup();

    const states: string[] = [];
    const unsub = instanceManager.onInstanceStateChange((_id, state) => {
      states.push(state);
    });

    const id = instanceManager.createInstance('test-app' as AppId, workspaceRoute);
    await instanceManager.launchInstance(id);
    instanceManager.suspendInstance(id);
    instanceManager.resumeInstance(id);
    instanceManager.closeInstance(id);

    expect(states).toEqual(['launching', 'running', 'suspended', 'running', 'closing', 'closed']);

    // Unsubscribe stops further callbacks
    unsub();
  });

  it('unsubscribe stops further callbacks', async () => {
    const { instanceManager } = setup();

    const states: string[] = [];
    const unsub = instanceManager.onInstanceStateChange((_id, state) => {
      states.push(state);
    });

    const id = instanceManager.createInstance('test-app' as AppId, workspaceRoute);
    await instanceManager.launchInstance(id);
    unsub();

    // These should not fire callbacks
    instanceManager.suspendInstance(id);
    instanceManager.resumeInstance(id);

    expect(states).toEqual(['launching', 'running']);
  });

  it('getInstance returns correct snapshot with timestamps', async () => {
    const { instanceManager } = setup();

    const before = Date.now();
    const id = instanceManager.createInstance('test-app' as AppId, workspaceRoute);
    await instanceManager.launchInstance(id);
    const after = Date.now();

    const snapshot = instanceManager.getInstance(id);
    expect(snapshot).toBeDefined();
    expect(snapshot!.appId).toBe('test-app');
    expect(snapshot!.state).toBe('running');
    expect(snapshot!.route).toEqual(workspaceRoute);
    expect(snapshot!.createdAt).toBeGreaterThanOrEqual(before);
    expect(snapshot!.createdAt).toBeLessThanOrEqual(after);
    expect(snapshot!.lastActiveAt).toBeGreaterThanOrEqual(before);
    expect(snapshot!.lastActiveAt).toBeLessThanOrEqual(after);
  });

  it('getInstance returns undefined for unknown instance', () => {
    const { instanceManager } = setup();
    expect(instanceManager.getInstance('nonexistent' as AppInstanceId)).toBeUndefined();
  });

  it('listInstances returns all instances', async () => {
    const { instanceManager } = setup();

    instanceManager.createInstance('test-app' as AppId, workspaceRoute);
    instanceManager.createInstance('test-app' as AppId, resourceRoute);

    expect(instanceManager.listInstances()).toHaveLength(2);
  });

  it('invalid state transition throws', async () => {
    const { instanceManager } = setup();

    const id = instanceManager.createInstance('test-app' as AppId, workspaceRoute);
    // Cannot suspend from created state (must be running)
    expect(() => instanceManager.suspendInstance(id)).toThrow('Invalid state transition');
  });
});
