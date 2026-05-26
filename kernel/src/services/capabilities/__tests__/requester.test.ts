/**
 * Capability Requester Tests
 *
 * Tests for:
 * - Runtime capability requests
 * - Rate limiting
 * - Denial tracking
 * - Integration with registry
 *
 */

import { jest } from '@jest/globals';

import type { CapabilityPromptResult } from '../cap-requester';
import { appId } from '../grants';

import { CapabilityRegistry } from '../registry';
import {
  CapabilityRequester,
  createCapabilityRequester,
  createMemoryGrantsStore,
  createSensitiveCapabilityHandler,
  SensitiveCapabilityHandler,
} from '../index';

describe('CapabilityRequester', () => {
  let store: ReturnType<typeof createMemoryGrantsStore>;
  let registry: CapabilityRegistry;
  let sensitiveHandler: SensitiveCapabilityHandler;
  let requester: CapabilityRequester;
  let promptFn: jest.Mock;
  const testAppId = appId('test-app');

  beforeEach(() => {
    store = createMemoryGrantsStore();
    registry = new CapabilityRegistry(store);
    sensitiveHandler = createSensitiveCapabilityHandler();
    sensitiveHandler.start();

    promptFn = jest.fn().mockResolvedValue({
      decision: 'grant',
    } as CapabilityPromptResult);

    requester = createCapabilityRequester({
      appId: testAppId,
      appName: 'Test App',
      registry,
      sensitiveHandler,
      promptUser: promptFn,
    });
  });

  afterEach(() => {
    requester.dispose();
    sensitiveHandler.dispose();
  });

  // ===========================================================================
  // Basic Request Flow
  // ===========================================================================

  describe('basic request flow', () => {
    it('should check if capability is already granted', () => {
      registry.grant(testAppId, 'cells:read');

      expect(requester.has('cells:read')).toBe(true);
      expect(requester.has('cells:write')).toBe(false);
    });

    it('should request a capability and prompt user', async () => {
      const granted = await requester.request('cells:write', 'Need to edit cells');

      expect(granted).toBe(true);
      expect(promptFn).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: testAppId,
          appName: 'Test App',
          requests: [{ capability: 'cells:write', reason: 'Need to edit cells' }],
        }),
      );
    });

    it('should grant capability after approval', async () => {
      const granted = await requester.request('cells:write', 'Need to edit cells');

      expect(granted).toBe(true);
      expect(registry.hasCapability(testAppId, 'cells:write')).toBe(true);
    });

    it('should skip prompt if capability already granted', async () => {
      registry.grant(testAppId, 'cells:read');

      const granted = await requester.request('cells:read', 'Need to read cells');

      expect(granted).toBe(true);
      expect(promptFn).not.toHaveBeenCalled();
    });

    it('should handle user denial', async () => {
      promptFn.mockResolvedValueOnce({ decision: 'deny' });

      const granted = await requester.request('network:any', 'Need network access');

      expect(granted).toBe(false);
      expect(registry.hasCapability(testAppId, 'network:any')).toBe(false);
    });

    it('should handle user cancellation', async () => {
      promptFn.mockResolvedValueOnce({ decision: 'cancel' });

      const granted = await requester.request('network:any', 'Need network access');

      expect(granted).toBe(false);
    });
  });

  // ===========================================================================
  // Multiple Capability Requests
  // ===========================================================================

  describe('multiple capability requests', () => {
    it('should request multiple capabilities at once', async () => {
      const result = await requester.requestMultiple([
        { capability: 'cells:read', reason: 'Read cells' },
        { capability: 'tables:read', reason: 'Read tables' },
      ]);

      expect(result.allGranted).toBe(true);
      expect(result.granted).toContain('cells:read');
      expect(result.granted).toContain('tables:read');
    });

    it('should handle partial grants', async () => {
      promptFn.mockResolvedValueOnce({
        decision: 'grant',
        grantedCapabilities: ['cells:read'],
      });

      const result = await requester.requestMultiple([
        { capability: 'cells:read', reason: 'Read cells' },
        { capability: 'tables:read', reason: 'Read tables' },
      ]);

      expect(result.allGranted).toBe(false);
      expect(result.granted).toContain('cells:read');
      expect(result.denied).toContain('tables:read');
    });

    it('should filter out already granted capabilities', async () => {
      registry.grant(testAppId, 'cells:read');

      const result = await requester.requestMultiple([
        { capability: 'cells:read', reason: 'Read cells' },
        { capability: 'tables:read', reason: 'Read tables' },
      ]);

      expect(result.allGranted).toBe(true);
      // Only tables:read should be in the prompt
      expect(promptFn).toHaveBeenCalledWith(
        expect.objectContaining({
          requests: [{ capability: 'tables:read', reason: 'Read tables' }],
        }),
      );
    });
  });

  // ===========================================================================
  // Rate Limiting
  // ===========================================================================

  describe('rate limiting', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should enforce rate limiting after request', async () => {
      promptFn.mockResolvedValueOnce({ decision: 'deny' });

      await requester.request('network:any', 'First request');

      // Second request should be rate limited
      const rateLimitStatus = requester.canRequest('network:any');

      expect(rateLimitStatus.canRequest).toBe(false);
      expect(rateLimitStatus.retryAfter).toBeDefined();
    });

    it('should allow request after cooldown period', async () => {
      promptFn.mockResolvedValueOnce({ decision: 'deny' });

      await requester.request('network:any', 'First request');

      // Advance past cooldown (30 seconds)
      jest.advanceTimersByTime(31 * 1000);

      const rateLimitStatus = requester.canRequest('network:any');
      expect(rateLimitStatus.canRequest).toBe(true);
    });

    it('should reject rate-limited requests in batch', async () => {
      promptFn.mockResolvedValueOnce({ decision: 'deny' });

      await requester.request('network:any', 'First request');

      // Try to request again immediately
      const result = await requester.requestMultiple([
        { capability: 'network:any', reason: 'Try again' },
      ]);

      expect(result.allGranted).toBe(false);
      expect(result.results[0]?.denialReason).toBe('rate-limited');
    });
  });

  // ===========================================================================
  // Denial Tracking
  // ===========================================================================

  describe('denial tracking', () => {
    it('should track denied capabilities', async () => {
      promptFn.mockResolvedValueOnce({ decision: 'deny' });

      await requester.request('network:any', 'Need network');

      expect(requester.isDenied('network:any')).toBe(true);
    });

    it('should return denial status', async () => {
      promptFn.mockResolvedValueOnce({ decision: 'deny' });

      await requester.request('network:any', 'Need network');

      const status = requester.getDenialStatus('network:any');
      expect(status?.reason).toBe('user-denied');
      expect(status?.deniedAt).toBeDefined();
    });

    it('should clear denial status', async () => {
      promptFn.mockResolvedValueOnce({ decision: 'deny' });

      await requester.request('network:any', 'Need network');
      requester.clearDenial('network:any');

      expect(requester.isDenied('network:any')).toBe(false);
    });

    it('should reject previously denied capabilities', async () => {
      promptFn.mockResolvedValueOnce({ decision: 'deny' });

      await requester.request('network:any', 'First request');

      // Advance past rate limit
      jest.useFakeTimers();
      jest.advanceTimersByTime(31 * 1000);

      const result = await requester.requestMultiple([
        { capability: 'network:any', reason: 'Try again' },
      ]);

      expect(result.allGranted).toBe(false);
      expect(result.results[0]?.denialReason).toBe('previously-denied');

      jest.useRealTimers();
    });
  });

  // ===========================================================================
  // Capability Change Notifications
  // ===========================================================================

  describe('capability change notifications', () => {
    it('should notify when capabilities change', async () => {
      const changeCallback = jest.fn();

      const requesterWithCallback = createCapabilityRequester({
        appId: testAppId,
        appName: 'Test App',
        registry,
        sensitiveHandler,
        promptUser: promptFn,
        onCapabilityChange: changeCallback,
      });

      await requesterWithCallback.request('cells:write', 'Need to edit');

      // Grant triggers callback via registry
      expect(changeCallback).toHaveBeenCalled();

      requesterWithCallback.dispose();
    });
  });

  // ===========================================================================
  // Scoped Requests
  // ===========================================================================

  describe('scoped requests', () => {
    it('should request scoped capability', async () => {
      const granted = await requester.requestScoped(
        'tables:read',
        'table:contacts',
        'Need to read contacts table',
      );

      expect(granted).toBe(true);
      expect(promptFn).toHaveBeenCalledWith(
        expect.objectContaining({
          requests: [
            {
              capability: 'tables:read',
              reason: 'Need to read contacts table',
              scope: 'table:contacts',
            },
          ],
        }),
      );
    });
  });
});
