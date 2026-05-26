/**
 * Re-Authentication Provider Tests
 *
 * Tests for:
 * - Web re-auth provider
 * - Desktop re-auth provider
 * - Re-auth requirement checking
 *
 */

import { jest } from '@jest/globals';

import { appId } from '../grants';

import {
  DesktopReAuthProvider,
  NoopReAuthProvider,
  WebReAuthProvider,
  createReAuthProvider,
  requireReAuthentication,
} from '../re-auth';

describe('WebReAuthProvider', () => {
  let provider: WebReAuthProvider;
  let passwordPrompt: jest.Mock;

  beforeEach(() => {
    passwordPrompt = jest.fn();
    provider = new WebReAuthProvider(passwordPrompt);
  });

  describe('availability', () => {
    it('should be available when password prompt is configured', () => {
      expect(provider.isAvailable()).toBe(true);
    });

    it('should not be available when no password prompt', () => {
      const noPromptProvider = new WebReAuthProvider();
      expect(noPromptProvider.isAvailable()).toBe(false);
    });

    it('should only support password method', () => {
      expect(provider.getAvailableMethods()).toEqual(['password']);
    });

    it('should report password method as available', () => {
      expect(provider.isMethodAvailable('password')).toBe(true);
      expect(provider.isMethodAvailable('biometric')).toBe(false);
    });
  });

  describe('authentication', () => {
    it('should authenticate with password', async () => {
      passwordPrompt.mockResolvedValue('mypassword');

      const result = await provider.authenticate({
        capability: 'credentials:use',
        appId: appId('test-app'),
        reason: 'Need credentials',
      });

      expect(result.success).toBe(true);
      expect(result.method).toBe('password');
      expect(result.timestamp).toBeDefined();
    });

    it('should fail when user cancels', async () => {
      passwordPrompt.mockResolvedValue(null);

      const result = await provider.authenticate({
        capability: 'credentials:use',
        appId: appId('test-app'),
        reason: 'Need credentials',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('User cancelled');
    });

    it('should fail when no prompt configured', async () => {
      const noPromptProvider = new WebReAuthProvider();

      const result = await noPromptProvider.authenticate({
        capability: 'credentials:use',
        appId: appId('test-app'),
        reason: 'Need credentials',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not configured');
    });

    it('should handle timeout', async () => {
      jest.useFakeTimers();

      passwordPrompt.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve('password'), 120000)),
      );

      const authPromise = provider.authenticate({
        capability: 'credentials:use',
        appId: appId('test-app'),
        reason: 'Need credentials',
        timeout: 5000,
      });

      jest.advanceTimersByTime(10000);

      const result = await authPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');

      jest.useRealTimers();
    });

    it('should handle cancellation', async () => {
      passwordPrompt.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve('password'), 1000)),
      );

      // Start auth
      const authPromise = provider.authenticate({
        capability: 'credentials:use',
        appId: appId('test-app'),
        reason: 'Need credentials',
      });

      // Cancel immediately
      provider.cancel();

      const result = await authPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('cancelled');
    });
  });
});

describe('DesktopReAuthProvider', () => {
  let provider: DesktopReAuthProvider;
  let biometricPrompt: jest.Mock;
  let passwordPrompt: jest.Mock;

  beforeEach(() => {
    biometricPrompt = jest.fn();
    passwordPrompt = jest.fn();
    provider = new DesktopReAuthProvider(biometricPrompt, passwordPrompt);
  });

  describe('availability', () => {
    it('should be available when any prompt is configured', () => {
      expect(provider.isAvailable()).toBe(true);
    });

    it('should not be available when no prompts', () => {
      const noPromptProvider = new DesktopReAuthProvider();
      expect(noPromptProvider.isAvailable()).toBe(false);
    });

    it('should report both methods as available', () => {
      expect(provider.getAvailableMethods()).toEqual(['biometric', 'password']);
      expect(provider.isMethodAvailable('biometric')).toBe(true);
      expect(provider.isMethodAvailable('password')).toBe(true);
    });

    it('should report only available methods', () => {
      const biometricOnly = new DesktopReAuthProvider(biometricPrompt);
      expect(biometricOnly.getAvailableMethods()).toEqual(['biometric']);
      expect(biometricOnly.isMethodAvailable('biometric')).toBe(true);
      expect(biometricOnly.isMethodAvailable('password')).toBe(false);
    });
  });

  describe('authentication', () => {
    it('should prefer biometric authentication', async () => {
      biometricPrompt.mockResolvedValue(true);

      const result = await provider.authenticate({
        capability: 'credentials:use',
        appId: appId('test-app'),
        reason: 'Need credentials',
      });

      expect(result.success).toBe(true);
      expect(result.method).toBe('biometric');
      expect(biometricPrompt).toHaveBeenCalled();
      expect(passwordPrompt).not.toHaveBeenCalled();
    });

    it('should fall back to password if biometric fails', async () => {
      biometricPrompt.mockResolvedValue(false);
      passwordPrompt.mockResolvedValue('password');

      const result = await provider.authenticate({
        capability: 'credentials:use',
        appId: appId('test-app'),
        reason: 'Need credentials',
      });

      expect(result.success).toBe(true);
      expect(result.method).toBe('password');
    });

    it('should use preferred method when specified', async () => {
      passwordPrompt.mockResolvedValue('password');

      const result = await provider.authenticate({
        capability: 'credentials:use',
        appId: appId('test-app'),
        reason: 'Need credentials',
        preferredMethod: 'password',
      });

      expect(result.success).toBe(true);
      expect(result.method).toBe('password');
      expect(passwordPrompt).toHaveBeenCalled();
      expect(biometricPrompt).not.toHaveBeenCalled();
    });

    it('should fail when both methods fail', async () => {
      biometricPrompt.mockResolvedValue(false);
      passwordPrompt.mockResolvedValue(null);

      const result = await provider.authenticate({
        capability: 'credentials:use',
        appId: appId('test-app'),
        reason: 'Need credentials',
      });

      expect(result.success).toBe(false);
    });
  });
});

describe('NoopReAuthProvider', () => {
  let provider: NoopReAuthProvider;

  beforeEach(() => {
    provider = new NoopReAuthProvider();
  });

  it('should always be available', () => {
    expect(provider.isAvailable()).toBe(true);
  });

  it('should always succeed', async () => {
    const result = await provider.authenticate({
      capability: 'credentials:use',
      appId: appId('test-app'),
      reason: 'Test',
    });

    expect(result.success).toBe(true);
  });
});

describe('createReAuthProvider', () => {
  it('should create WebReAuthProvider for web platform', () => {
    const provider = createReAuthProvider('web', {
      webPasswordPrompt: jest.fn(),
    });

    expect(provider).toBeInstanceOf(WebReAuthProvider);
  });

  it('should create DesktopReAuthProvider for desktop platform', () => {
    const provider = createReAuthProvider('desktop', {
      biometricPrompt: jest.fn(),
    });

    expect(provider).toBeInstanceOf(DesktopReAuthProvider);
  });

  it('should create DesktopReAuthProvider for tauri platform', () => {
    const provider = createReAuthProvider('tauri', {
      biometricPrompt: jest.fn(),
    });

    expect(provider).toBeInstanceOf(DesktopReAuthProvider);
  });
});

describe('requireReAuthentication', () => {
  const testAppId = appId('test-app');

  it('should require re-auth for sensitive capabilities', async () => {
    const provider = new NoopReAuthProvider();

    const result = await requireReAuthentication(
      'credentials:use',
      provider,
      testAppId,
      'Need credentials',
    );

    expect(result.authenticated).toBe(true);
  });

  it('should not require re-auth for non-sensitive capabilities', async () => {
    const provider = new NoopReAuthProvider();

    const result = await requireReAuthentication('cells:read', provider, testAppId, 'Read cells');

    // Should succeed without actually calling provider
    expect(result.authenticated).toBe(true);
  });

  it('should fail when provider is not available', async () => {
    const provider = new WebReAuthProvider(); // No prompt configured

    const result = await requireReAuthentication(
      'credentials:use',
      provider,
      testAppId,
      'Need credentials',
    );

    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('not available');
  });
});
