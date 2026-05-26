/**
 * Sensitive Capability Handler Tests
 *
 * Tests for:
 * - Session management
 * - Session expiry
 * - Expiry warnings
 * - Rate limiting
 *
 */

import { jest } from '@jest/globals';

import { appId } from '../grants';

import { SensitiveCapabilityHandler, createSensitiveCapabilityHandler } from '../sensitive-handler';

describe('SensitiveCapabilityHandler', () => {
  let handler: SensitiveCapabilityHandler;
  const testAppId = appId('test-app');

  beforeEach(() => {
    handler = createSensitiveCapabilityHandler();
    jest.useFakeTimers();
  });

  afterEach(() => {
    handler.dispose();
    jest.useRealTimers();
  });

  // ===========================================================================
  // Session Management
  // ===========================================================================

  describe('session management', () => {
    it('should create a session grant', () => {
      const session = handler.createSession(testAppId, 'credentials:use');

      expect(session).toBeDefined();
      expect(session.grant.appId).toBe(testAppId);
      expect(session.grant.capability).toBe('credentials:use');
      expect(session.expiresAt).toBeGreaterThan(Date.now());
    });

    it('should create session with custom duration', () => {
      const duration = 10 * 60 * 1000; // 10 minutes
      const session = handler.createSession(testAppId, 'credentials:use', {
        duration,
      });

      const expectedExpiry = Date.now() + duration;
      expect(session.expiresAt).toBeCloseTo(expectedExpiry, -3); // Within 1 second
      expect(session.duration).toBe(duration);
    });

    it('should retrieve active session', () => {
      handler.createSession(testAppId, 'credentials:use');

      const session = handler.getSession(testAppId, 'credentials:use');

      expect(session).toBeDefined();
      expect(session?.grant.capability).toBe('credentials:use');
    });

    it('should return undefined for non-existent session', () => {
      const session = handler.getSession(testAppId, 'credentials:use');

      expect(session).toBeUndefined();
    });

    it('should validate session is still valid', () => {
      const session = handler.createSession(testAppId, 'credentials:use', {
        duration: 5000, // 5 seconds
      });

      expect(handler.isSessionValid(session)).toBe(true);

      // Advance past expiry
      jest.advanceTimersByTime(6000);

      expect(handler.isSessionValid(session)).toBe(false);
    });

    it('should return undefined for expired session when retrieving', () => {
      handler.createSession(testAppId, 'credentials:use', {
        duration: 5000,
      });

      jest.advanceTimersByTime(6000);

      const session = handler.getSession(testAppId, 'credentials:use');
      expect(session).toBeUndefined();
    });

    it('should get all active sessions for an app', () => {
      handler.createSession(testAppId, 'credentials:use');
      handler.createSession(testAppId, 'connections:native');

      const sessions = handler.getActiveSessions(testAppId);

      expect(sessions).toHaveLength(2);
    });

    it('should filter out expired sessions from active list', () => {
      handler.createSession(testAppId, 'credentials:use', { duration: 5000 });
      handler.createSession(testAppId, 'connections:native', { duration: 60000 });

      jest.advanceTimersByTime(10000);

      const sessions = handler.getActiveSessions(testAppId);

      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.grant.capability).toBe('connections:native');
    });
  });

  // ===========================================================================
  // Session Extension
  // ===========================================================================

  describe('session extension', () => {
    it('should extend a session', () => {
      const session = handler.createSession(testAppId, 'credentials:use', {
        duration: 5000,
      });

      const originalExpiry = session.expiresAt;

      jest.advanceTimersByTime(2000);

      const extended = handler.extendSession(session);

      expect(extended).not.toBeNull();
      expect(extended!.expiresAt).toBeGreaterThan(originalExpiry);
      expect(extended!.extensionCount).toBe(1);
    });

    it('should not extend beyond max extensions', () => {
      const session = handler.createSession(testAppId, 'credentials:use', {
        duration: 5000,
        maxExtensions: 2,
      });

      let current = session;

      // First extension
      current = handler.extendSession(current)!;
      expect(current).not.toBeNull();

      // Second extension
      current = handler.extendSession(current)!;
      expect(current).not.toBeNull();

      // Third extension should fail
      const third = handler.extendSession(current);
      expect(third).toBeNull();
    });

    it('should not extend if extension not allowed', () => {
      const session = handler.createSession(testAppId, 'credentials:use', {
        duration: 5000,
        extensionAllowed: false,
      });

      const extended = handler.extendSession(session);

      expect(extended).toBeNull();
    });

    it('should use custom duration for extension', () => {
      const session = handler.createSession(testAppId, 'credentials:use', {
        duration: 5000,
      });

      jest.advanceTimersByTime(2000);

      const customDuration = 60000; // 1 minute
      const extended = handler.extendSession(session, customDuration);

      const expectedExpiry = Date.now() + customDuration;
      expect(extended!.expiresAt).toBeCloseTo(expectedExpiry, -3);
    });
  });

  // ===========================================================================
  // Session Termination
  // ===========================================================================

  describe('session termination', () => {
    it('should end a specific session', () => {
      handler.createSession(testAppId, 'credentials:use');
      handler.createSession(testAppId, 'connections:native');

      handler.endSession(testAppId, 'credentials:use');

      expect(handler.getSession(testAppId, 'credentials:use')).toBeUndefined();
      expect(handler.getSession(testAppId, 'connections:native')).toBeDefined();
    });

    it('should end all sessions for an app', () => {
      handler.createSession(testAppId, 'credentials:use');
      handler.createSession(testAppId, 'connections:native');

      handler.endAllSessions(testAppId);

      expect(handler.getActiveSessions(testAppId)).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Expiry Warnings
  // ===========================================================================

  describe('expiry warnings', () => {
    it('should emit warning before expiry', () => {
      const warningCallback = jest.fn();
      handler.onCapabilityExpiring(warningCallback);
      handler.start();

      // Create session with 70 second duration
      handler.createSession(testAppId, 'credentials:use', {
        duration: 70 * 1000,
      });

      // Advance to just past 1 minute warning (10 seconds remaining)
      jest.advanceTimersByTime(60 * 1000 + 1);

      // Trigger check (normally runs every 10 seconds)
      jest.advanceTimersByTime(10 * 1000);

      expect(warningCallback).toHaveBeenCalled();
      expect(warningCallback.mock.calls[0][0]).toMatchObject({
        appId: testAppId,
        capability: 'credentials:use',
        level: expect.stringMatching(/info|warning|critical/),
      });
    });

    it('should emit expired callback when session expires', () => {
      const expiredCallback = jest.fn();
      handler.onCapabilityExpired(expiredCallback);
      handler.start();

      handler.createSession(testAppId, 'credentials:use', {
        duration: 5000,
      });

      // Advance past expiry
      jest.advanceTimersByTime(10 * 1000);

      // Wait for check interval
      jest.advanceTimersByTime(10 * 1000);

      expect(expiredCallback).toHaveBeenCalledWith(testAppId, 'credentials:use');
    });

    it('should get remaining time for session', () => {
      handler.createSession(testAppId, 'credentials:use', {
        duration: 60 * 1000, // 1 minute
      });

      const remaining = handler.getRemainingTime(testAppId, 'credentials:use');

      expect(remaining).toBeDefined();
      expect(remaining).toBeGreaterThan(50 * 1000);
      expect(remaining).toBeLessThanOrEqual(60 * 1000);
    });

    it('should return undefined for non-existent session remaining time', () => {
      const remaining = handler.getRemainingTime(testAppId, 'credentials:use');

      expect(remaining).toBeUndefined();
    });

    it('should allow unsubscribing from warnings', () => {
      const warningCallback = jest.fn();
      const unsubscribe = handler.onCapabilityExpiring(warningCallback);
      handler.start();

      unsubscribe();

      handler.createSession(testAppId, 'credentials:use', {
        duration: 10 * 1000,
      });

      jest.advanceTimersByTime(20 * 1000);

      expect(warningCallback).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Rate Limiting
  // ===========================================================================

  describe('rate limiting', () => {
    it('should allow first request', () => {
      const status = handler.canRequestAgain(testAppId, 'credentials:use');

      expect(status.canRequest).toBe(true);
      expect(status.requestCount).toBe(0);
    });

    it('should rate limit after request', () => {
      handler.recordRequest(testAppId, 'credentials:use');

      const status = handler.canRequestAgain(testAppId, 'credentials:use');

      expect(status.canRequest).toBe(false);
      expect(status.retryAfter).toBeDefined();
      expect(status.retryInSeconds).toBeGreaterThan(0);
      expect(status.requestCount).toBe(1);
    });

    it('should allow request after cooldown', () => {
      handler.recordRequest(testAppId, 'credentials:use');

      // Advance past 30 second cooldown
      jest.advanceTimersByTime(31 * 1000);

      const status = handler.canRequestAgain(testAppId, 'credentials:use');

      expect(status.canRequest).toBe(true);
    });

    it('should clear rate limit', () => {
      handler.recordRequest(testAppId, 'credentials:use');

      handler.clearRateLimit(testAppId, 'credentials:use');

      const status = handler.canRequestAgain(testAppId, 'credentials:use');
      expect(status.canRequest).toBe(true);
    });

    it('should track request count', () => {
      handler.recordRequest(testAppId, 'credentials:use');

      // Advance past cooldown
      jest.advanceTimersByTime(31 * 1000);

      handler.recordRequest(testAppId, 'credentials:use');

      const status = handler.canRequestAgain(testAppId, 'credentials:use');
      expect(status.requestCount).toBe(2);
    });

    it('should rate limit per capability', () => {
      handler.recordRequest(testAppId, 'credentials:use');

      // credentials:use should be rate limited
      expect(handler.canRequestAgain(testAppId, 'credentials:use').canRequest).toBe(false);

      // connections:native should not be rate limited
      expect(handler.canRequestAgain(testAppId, 'connections:native').canRequest).toBe(true);
    });

    it('should rate limit per app', () => {
      const otherAppId = appId('other-app');

      handler.recordRequest(testAppId, 'credentials:use');

      // test-app should be rate limited
      expect(handler.canRequestAgain(testAppId, 'credentials:use').canRequest).toBe(false);

      // other-app should not be rate limited
      expect(handler.canRequestAgain(otherAppId, 'credentials:use').canRequest).toBe(true);
    });
  });

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  describe('lifecycle', () => {
    it('should start and stop monitoring', () => {
      const warningCallback = jest.fn();
      handler.onCapabilityExpiring(warningCallback);

      // Not started - no warnings
      handler.createSession(testAppId, 'credentials:use', { duration: 5000 });
      jest.advanceTimersByTime(60 * 1000);
      expect(warningCallback).not.toHaveBeenCalled();

      // Start monitoring
      handler.start();
      handler.createSession(testAppId, 'credentials:use', { duration: 70 * 1000 });
      jest.advanceTimersByTime(70 * 1000);
      expect(warningCallback).toHaveBeenCalled();

      // Stop monitoring
      warningCallback.mockClear();
      handler.stop();
      handler.createSession(testAppId, 'credentials:use', { duration: 5000 });
      jest.advanceTimersByTime(60 * 1000);
      expect(warningCallback).not.toHaveBeenCalled();
    });

    it('should clear all state on dispose', () => {
      handler.createSession(testAppId, 'credentials:use');
      handler.recordRequest(testAppId, 'credentials:use');

      handler.dispose();

      expect(handler.getActiveSessions(testAppId)).toHaveLength(0);
      expect(handler.canRequestAgain(testAppId, 'credentials:use').canRequest).toBe(true);
    });
  });
});
