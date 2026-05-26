/**
 * Tests for useAppKernel hook
 *
 */

import { act, renderHook, waitFor } from '@testing-library/react';

import { appId as createAppId } from '@mog-sdk/kernel/security';
import type { IAppKernelAPI } from '@mog-sdk/contracts/apps';
import type { CapabilityType } from '@mog-sdk/contracts/capabilities';

import type { ICapabilityRegistry } from '@mog-sdk/kernel/security';

import { useAppKernel } from '../use-app-kernel';
import { createShellCapabilityRegistry } from '../../services/capabilities';

// =============================================================================
// Mocks
// =============================================================================

// Mock the createCapabilityGatedApi function. The hook imports the dedicated
// app API subpath; mocking the root package would still load the real app-api
// module and its transport dependency in Jest.
jest.mock('@mog-sdk/kernel/app-api', () => ({
  createCapabilityGatedApi: jest.fn((options) => ({
    capabilities: {
      has: (cap: CapabilityType) => options.registry.hasCapability(options.appId, cap),
      list: () => options.registry.getEffectiveCapabilities(options.appId),
      isScoped: jest.fn().mockReturnValue(false),
      getScope: jest.fn().mockReturnValue(null),
      hasAccessTo: jest.fn().mockReturnValue(true),
      request: jest.fn().mockResolvedValue(true),
      onChange: jest.fn().mockReturnValue(() => {}),
      onExpiring: jest.fn().mockReturnValue(() => {}),
    },
    undoGroup: jest.fn(async (fn) => fn()),
  })),
}));

function createMockKernelApi(): IAppKernelAPI {
  return {
    tables: {
      list: jest.fn().mockReturnValue([]),
      get: jest.fn().mockReturnValue(null),
      findByName: jest.fn().mockReturnValue(null),
      create: jest.fn(),
      delete: jest.fn(),
      rename: jest.fn(),
    },
    columns: {
      list: jest.fn().mockReturnValue([]),
      get: jest.fn().mockReturnValue(null),
      findByName: jest.fn().mockReturnValue(null),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      move: jest.fn(),
    },
    records: {
      list: jest.fn().mockReturnValue([]),
      get: jest.fn().mockReturnValue(null),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      query: jest.fn().mockReturnValue([]),
    },
    relations: {
      getRelated: jest.fn().mockReturnValue([]),
      link: jest.fn(),
      unlink: jest.fn(),
    },
    events: {
      subscribe: jest.fn().mockReturnValue(() => {}),
      subscribeFiltered: jest.fn().mockReturnValue(() => {}),
    },
    clipboard: {
      copy: jest.fn(),
      cut: jest.fn(),
      paste: jest.fn(),
      canPaste: jest.fn().mockReturnValue(false),
      getClipboardContent: jest.fn().mockReturnValue(null),
    },
    undo: {
      canUndo: jest.fn().mockReturnValue(false),
      canRedo: jest.fn().mockReturnValue(false),
      undo: jest.fn(),
      redo: jest.fn(),
      getUndoLabel: jest.fn().mockReturnValue(null),
      getRedoLabel: jest.fn().mockReturnValue(null),
      subscribe: jest.fn().mockReturnValue(() => {}),
    },
    batch: jest.fn(async (fn) => fn()),
  } as unknown as IAppKernelAPI;
}

// =============================================================================
// Tests
// =============================================================================

describe('useAppKernel', () => {
  let registry: ICapabilityRegistry;
  let fullApi: IAppKernelAPI;

  beforeEach(() => {
    registry = createShellCapabilityRegistry();
    fullApi = createMockKernelApi();
  });

  it('should return gated API', () => {
    const appIdObj = createAppId('test-app');
    registry.grant(appIdObj, 'cells:read');

    const { result } = renderHook(() =>
      useAppKernel({
        appId: 'test-app',
        fullApi,
        registry,
      }),
    );

    expect(result.current.api).not.toBeNull();
    expect(result.current.api?.capabilities).toBeDefined();
  });

  it('should return current capabilities', () => {
    const appIdObj = createAppId('test-app');
    registry.grant(appIdObj, 'cells:read');
    registry.grant(appIdObj, 'tables:read');

    const { result } = renderHook(() =>
      useAppKernel({
        appId: 'test-app',
        fullApi,
        registry,
      }),
    );

    expect(result.current.capabilities).toContain('cells:read');
    expect(result.current.capabilities).toContain('tables:read');
  });

  it('should hot-reload when capabilities are granted', async () => {
    const appIdObj = createAppId('test-app');

    const { result } = renderHook(() =>
      useAppKernel({
        appId: 'test-app',
        fullApi,
        registry,
      }),
    );

    const initialCapabilities = result.current.capabilities;

    // Grant a new capability
    act(() => {
      registry.grant(appIdObj, 'cells:write');
    });

    // Wait for the hook to update
    await waitFor(() => {
      expect(result.current.capabilities).toContain('cells:write');
    });

    // Capabilities should have changed
    expect(result.current.capabilities.length).toBeGreaterThan(initialCapabilities.length);
  });

  it('should hot-reload when capabilities are revoked', async () => {
    const appIdObj = createAppId('test-app');
    registry.grant(appIdObj, 'cells:read');
    registry.grant(appIdObj, 'cells:write');

    const { result } = renderHook(() =>
      useAppKernel({
        appId: 'test-app',
        fullApi,
        registry,
      }),
    );

    expect(result.current.capabilities).toContain('cells:write');

    // Revoke a capability
    act(() => {
      registry.revoke(appIdObj, 'cells:write');
    });

    // Wait for the hook to update
    await waitFor(() => {
      expect(result.current.capabilities).not.toContain('cells:write');
    });
  });

  it('should provide refresh function', () => {
    const { result } = renderHook(() =>
      useAppKernel({
        appId: 'test-app',
        fullApi,
        registry,
      }),
    );

    expect(result.current.refresh).toBeInstanceOf(Function);

    // Should not throw
    act(() => {
      result.current.refresh();
    });
  });

  it('should cleanup on unmount', () => {
    const appIdObj = createAppId('test-app');
    registry.grant(appIdObj, 'cells:read');

    const { unmount } = renderHook(() =>
      useAppKernel({
        appId: 'test-app',
        fullApi,
        registry,
      }),
    );

    // Should not throw on unmount
    unmount();

    // Granting after unmount should not cause errors
    act(() => {
      registry.grant(appIdObj, 'tables:read');
    });
  });

  it('should work with domain allowlist', () => {
    const appIdObj = createAppId('test-app');
    registry.grant(appIdObj, 'network:allowlist');

    const { result } = renderHook(() =>
      useAppKernel({
        appId: 'test-app',
        fullApi,
        registry,
        domainAllowlist: ['api.example.com', 'data.example.com'],
      }),
    );

    expect(result.current.api).not.toBeNull();
  });
});

describe('useAppKernel with implied capabilities', () => {
  let registry: ICapabilityRegistry;
  let fullApi: IAppKernelAPI;

  beforeEach(() => {
    registry = createShellCapabilityRegistry();
    fullApi = createMockKernelApi();
  });

  it('should include implied capabilities in the list', () => {
    const appIdObj = createAppId('test-app');
    // cells:write implies cells:read
    registry.grant(appIdObj, 'cells:write');

    const { result } = renderHook(() =>
      useAppKernel({
        appId: 'test-app',
        fullApi,
        registry,
      }),
    );

    expect(result.current.capabilities).toContain('cells:write');
    expect(result.current.capabilities).toContain('cells:read');
  });
});
