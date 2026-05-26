import { createAppHostContext } from '../app-host-context-factory';
import { createShellHostServices } from '../host-services';
import type { AppId, AppManifest, RouteSnapshot } from '../types';

/** Create a branded AppId without importing the kernel capability service. */
function appId(id: string): AppId {
  return id as AppId;
}

describe('createAppHostContext', () => {
  it('creates a valid AppHostContext with all fields populated', () => {
    const manifest: AppManifest = {
      id: appId('test-app'),
      name: 'Test App',
      version: '1.0.0',
      description: 'A test app',
    };

    const route: RouteSnapshot = {
      path: '/workbook/abc',
      target: {
        appId: appId('test-app'),
        resourceKind: 'mog.resource.workbook',
        path: '/workbook/abc',
      },
      params: { id: 'abc' },
    };

    const bindings = [
      {
        resourceKind: 'mog.resource.workbook',
        resourceId: 'abc',
        accessMode: 'readwrite' as const,
        label: 'Main workbook',
      },
    ];

    const services = createShellHostServices({});
    const capabilities = ['clipboard.read', 'clipboard.write'];

    const context = createAppHostContext({
      instanceId: 'inst-1',
      manifest,
      route,
      bindings,
      services,
      capabilities,
    });

    expect(context.instanceId).toBe('inst-1');
    expect(context.manifest).toBe(manifest);
    expect(context.route).toBe(route);
    expect(context.bindings).toHaveLength(1);
    expect(context.bindings[0].resourceKind).toBe('mog.resource.workbook');
    expect(context.services).toBe(services);
    expect(context.capabilities).toEqual(['clipboard.read', 'clipboard.write']);
  });

  it('freezes the context object', () => {
    const services = createShellHostServices({});
    const context = createAppHostContext({
      instanceId: 'inst-2',
      manifest: { id: appId('app'), name: 'App', version: '0.1.0' },
      route: { path: '/', target: null, params: {} },
      bindings: [],
      services,
      capabilities: [],
    });

    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.bindings)).toBe(true);
    expect(Object.isFrozen(context.capabilities)).toBe(true);
  });
});
