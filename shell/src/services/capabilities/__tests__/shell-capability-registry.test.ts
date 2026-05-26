import { appId as createAppId } from '@mog-sdk/kernel/security';

import {
  createPermissiveShellCapabilityRegistry,
  createShellCapabilityRegistry,
} from '../registry';

describe('createShellCapabilityRegistry', () => {
  it('grants dependencies and reports effective capabilities', () => {
    const registry = createShellCapabilityRegistry({ audit: false });
    const testApp = createAppId('test-app');

    registry.grant(testApp, 'cells:write');

    expect(registry.hasCapability(testApp, 'cells:write')).toBe(true);
    expect(registry.hasCapability(testApp, 'cells:read')).toBe(true);
    expect(registry.getEffectiveCapabilities(testApp)).toEqual(
      expect.arrayContaining(['cells:write', 'cells:read']),
    );
  });

  it('hot-reloads subscribers with disposable event handles', () => {
    const registry = createShellCapabilityRegistry({ audit: false });
    const testApp = createAppId('test-app');
    const events: string[] = [];

    const subscription = registry.on('capability:granted', (event) => {
      events.push(`${event.appId}:${event.capability}`);
    });

    registry.grant(testApp, 'tables:read');
    subscription.dispose();
    registry.grant(testApp, 'cells:read');

    expect(events).toEqual(['test-app:tables:read']);
  });

  it('revokes dependent capabilities when a dependency is revoked', () => {
    const registry = createShellCapabilityRegistry({ audit: false });
    const testApp = createAppId('test-app');

    registry.grant(testApp, 'cells:write');
    registry.revoke(testApp, 'cells:read');

    expect(registry.hasCapability(testApp, 'cells:read')).toBe(false);
    expect(registry.hasCapability(testApp, 'cells:write')).toBe(false);
  });

  it('notifies app and global grant subscribers', () => {
    const registry = createShellCapabilityRegistry({ audit: false });
    const testApp = createAppId('test-app');
    const appEvents: string[] = [];
    const allEvents: string[] = [];

    const unsubscribeApp = registry.subscribeToApp(testApp, (event) => {
      appEvents.push(event.type);
    });
    const unsubscribeAll = registry.subscribeToAll((event) => {
      allEvents.push(event.type);
    });

    registry.grant(testApp, 'sheets:read');
    registry.revoke(testApp, 'sheets:read');
    unsubscribeApp();
    unsubscribeAll();
    registry.grant(testApp, 'cells:read');

    expect(appEvents).toEqual(['granted', 'revoked']);
    expect(allEvents).toEqual(['granted', 'revoked']);
  });

  it('records audit entries from the shell-owned audit log', () => {
    const registry = createShellCapabilityRegistry({ audit: { autoPrune: false } });
    const testApp = createAppId('test-app');

    registry.grant(testApp, 'cells:read');
    registry.hasCapability(testApp, 'cells:read');

    const entries = registry.auditLogger?.getEntries(testApp) ?? [];
    expect(entries.map((entry) => entry.eventType)).toEqual(
      expect.arrayContaining(['granted', 'check-passed']),
    );
  });
});

describe('createPermissiveShellCapabilityRegistry', () => {
  it('allows capability checks without granting concrete capabilities', () => {
    const registry = createPermissiveShellCapabilityRegistry({ audit: false });
    const testApp = createAppId('embed-host');

    expect(registry.hasCapability(testApp, 'network:any')).toBe(true);
    expect(registry.getEffectiveCapabilities(testApp)).toContain('network:any');
  });
});
