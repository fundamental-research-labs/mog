/**
 * Conformance tests — routing and resource binding.
 */

import { createResourceBindingService } from '../../resource-binding-service';
import { createResourceProviderRegistry } from '../../resource-provider-registry';
import type { BindingError } from '../../resource-binding-service';
import type { IResourceProviderRegistry } from '../../resource-provider-registry';
import type { AppInstanceId, ResolvedResourceBinding } from '../../types';

const WORKBOOK_KIND = 'mog.resource.workbook';

function makeProviderRegistry(): IResourceProviderRegistry {
  const registry = createResourceProviderRegistry();
  registry.registerProvider({
    resourceKind: WORKBOOK_KIND,
    ownerPackageId: 'mog.core',
    routePattern: '/workbook/:id',
    supportedAccessModes: ['readwrite'],
  });
  return registry;
}

function expectBinding(result: ResolvedResourceBinding | BindingError): ResolvedResourceBinding {
  expect('ok' in result && result.ok === false).toBe(false);
  return result as ResolvedResourceBinding;
}

describe('Routing and Resource Binding', () => {
  it('registers a workbook resource provider', () => {
    const registry = makeProviderRegistry();
    const provider = registry.getProvider(WORKBOOK_KIND);
    expect(provider).toBeDefined();
    expect(provider!.resourceKind).toBe(WORKBOOK_KIND);
  });

  it('resolves a workbook route to the correct provider and resource ref', () => {
    const registry = makeProviderRegistry();
    const result = registry.resolveRoute('/workbook/abc');
    expect(result).toBeDefined();
    expect(result!.provider.resourceKind).toBe(WORKBOOK_KIND);
    expect(result!.resourceRef).toEqual({ kind: WORKBOOK_KIND, id: 'abc' });
  });

  it('two app instances with different resource bindings get independent snapshots', () => {
    const bindingService = createResourceBindingService();

    const instanceA = 'inst-a' as AppInstanceId;
    const instanceB = 'inst-b' as AppInstanceId;

    const bindingA = expectBinding(
      bindingService.resolveBinding(
        {
          resourceKind: WORKBOOK_KIND,
          resourceId: 'w1',
          accessMode: 'readwrite',
          label: 'Workbook w1',
        },
        instanceA,
      ),
    );
    const bindingB = expectBinding(
      bindingService.resolveBinding(
        {
          resourceKind: WORKBOOK_KIND,
          resourceId: 'w2',
          accessMode: 'readwrite',
          label: 'Workbook w2',
        },
        instanceB,
      ),
    );

    expect(bindingService.createBindingSnapshot(bindingA)).toEqual({
      resourceKind: WORKBOOK_KIND,
      resourceId: 'w1',
      accessMode: 'readwrite',
      label: 'Workbook w1',
    });
    expect(bindingService.createBindingSnapshot(bindingB)).toEqual({
      resourceKind: WORKBOOK_KIND,
      resourceId: 'w2',
      accessMode: 'readwrite',
      label: 'Workbook w2',
    });
    expect(bindingA.leaseId).not.toBe(bindingB.leaseId);
  });

  it('lease lookup round-trips for two different app instances', () => {
    const bindingService = createResourceBindingService();

    const bindingA = expectBinding(
      bindingService.resolveBinding(
        { resourceKind: WORKBOOK_KIND, resourceId: 'w1', accessMode: 'readwrite' },
        'inst-a' as AppInstanceId,
      ),
    );
    const bindingB = expectBinding(
      bindingService.resolveBinding(
        { resourceKind: WORKBOOK_KIND, resourceId: 'w2', accessMode: 'readwrite' },
        'inst-b' as AppInstanceId,
      ),
    );

    expect(bindingService.getBinding(bindingA.leaseId)?.grantSubject).toBe('inst-a');
    expect(bindingService.getBinding(bindingA.leaseId)?.resourceRef.id).toBe('w1');
    expect(bindingService.getBinding(bindingB.leaseId)?.grantSubject).toBe('inst-b');
    expect(bindingService.getBinding(bindingB.leaseId)?.resourceRef.id).toBe('w2');
  });
});
