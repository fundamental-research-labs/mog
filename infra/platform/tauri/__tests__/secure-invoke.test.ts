/**
 * Tests for the secure invocation layer.
 *
 * Note: These tests cover the pure logic (security levels, command registry).
 * Integration tests with actual Tauri IPC require the Tauri runtime.
 */

/// <reference types="jest" />
import { jest } from '@jest/globals';

jest.unstable_mockModule('@tauri-apps/api/core', () => ({
  invoke: jest.fn(),
}));

jest.unstable_mockModule('@mog/env', () => ({
  isDev: () => false,
}));

jest.unstable_mockModule('../security', () => ({
  ensureSessionInitialized: jest.fn(),
  signRequest: jest.fn(),
}));

const {
  SecurityLevel,
  commandIsAudited,
  commandRequiresBiometric,
  getCommandSecurityLevel,
  getSecurityLevelDescription,
} = await import('../secure-invoke');

describe('SecurityLevel enum', () => {
  it('has correct numeric values for comparison', () => {
    expect(SecurityLevel.Public).toBe(0);
    expect(SecurityLevel.Signed).toBe(1);
    expect(SecurityLevel.Verified).toBe(2);
    expect(SecurityLevel.Protected).toBe(3);
    expect(SecurityLevel.Sensitive).toBe(4);
    expect(SecurityLevel.Critical).toBe(5);
  });

  it('supports comparison operators', () => {
    expect(SecurityLevel.Critical > SecurityLevel.Sensitive).toBe(true);
    expect(SecurityLevel.Sensitive > SecurityLevel.Protected).toBe(true);
    expect(SecurityLevel.Protected > SecurityLevel.Verified).toBe(true);
    expect(SecurityLevel.Verified > SecurityLevel.Signed).toBe(true);
    expect(SecurityLevel.Signed > SecurityLevel.Public).toBe(true);
  });
});

describe('getCommandSecurityLevel', () => {
  describe('credential commands', () => {
    it('returns Critical for credential_store', () => {
      expect(getCommandSecurityLevel('credential_store')).toBe(SecurityLevel.Critical);
    });

    it('returns Critical for credential_delete', () => {
      expect(getCommandSecurityLevel('credential_delete')).toBe(SecurityLevel.Critical);
    });

    it('returns Sensitive for credential_get', () => {
      expect(getCommandSecurityLevel('credential_get')).toBe(SecurityLevel.Sensitive);
    });

    it('returns Protected for credential_exists', () => {
      expect(getCommandSecurityLevel('credential_exists')).toBe(SecurityLevel.Protected);
    });

    it('returns Protected for credential_list', () => {
      expect(getCommandSecurityLevel('credential_list')).toBe(SecurityLevel.Protected);
    });
  });

  describe('file commands', () => {
    it('returns Verified for read_file', () => {
      expect(getCommandSecurityLevel('read_file')).toBe(SecurityLevel.Verified);
    });

    it('returns Sensitive for write_file', () => {
      expect(getCommandSecurityLevel('write_file')).toBe(SecurityLevel.Sensitive);
    });

    it('returns Critical for delete_path', () => {
      expect(getCommandSecurityLevel('delete_path')).toBe(SecurityLevel.Critical);
    });
  });

  describe('public commands', () => {
    it('returns Public for get_app_version', () => {
      expect(getCommandSecurityLevel('get_app_version')).toBe(SecurityLevel.Public);
    });

    it('returns Public for init_security_session', () => {
      expect(getCommandSecurityLevel('init_security_session')).toBe(SecurityLevel.Public);
    });
  });

  describe('unknown commands', () => {
    it('defaults to Verified for unknown commands', () => {
      expect(getCommandSecurityLevel('unknown_command')).toBe(SecurityLevel.Verified);
      expect(getCommandSecurityLevel('some_random_command')).toBe(SecurityLevel.Verified);
    });
  });
});

describe('commandRequiresBiometric', () => {
  it('returns true for Critical level commands', () => {
    expect(commandRequiresBiometric('credential_store')).toBe(true);
    expect(commandRequiresBiometric('credential_delete')).toBe(true);
    expect(commandRequiresBiometric('delete_path')).toBe(true);
  });

  it('returns false for Sensitive level commands', () => {
    expect(commandRequiresBiometric('credential_get')).toBe(false);
    expect(commandRequiresBiometric('write_file')).toBe(false);
  });

  it('returns false for Protected level commands', () => {
    expect(commandRequiresBiometric('credential_exists')).toBe(false);
    expect(commandRequiresBiometric('credential_list')).toBe(false);
  });

  it('returns false for Verified level commands', () => {
    expect(commandRequiresBiometric('read_file')).toBe(false);
  });

  it('returns false for Public level commands', () => {
    expect(commandRequiresBiometric('get_app_version')).toBe(false);
    expect(commandRequiresBiometric('init_security_session')).toBe(false);
  });
});

describe('commandIsAudited', () => {
  it('returns true for Critical level commands', () => {
    expect(commandIsAudited('credential_store')).toBe(true);
    expect(commandIsAudited('credential_delete')).toBe(true);
  });

  it('returns true for Sensitive level commands', () => {
    expect(commandIsAudited('credential_get')).toBe(true);
  });

  it('returns false for Protected level commands', () => {
    expect(commandIsAudited('credential_exists')).toBe(false);
    expect(commandIsAudited('credential_list')).toBe(false);
  });

  it('returns false for Verified level commands', () => {
    expect(commandIsAudited('read_file')).toBe(false);
  });

  it('returns false for Public level commands', () => {
    expect(commandIsAudited('get_app_version')).toBe(false);
  });
});

describe('getSecurityLevelDescription', () => {
  it('returns correct description for each level', () => {
    expect(getSecurityLevelDescription(SecurityLevel.Public)).toContain('Public');
    expect(getSecurityLevelDescription(SecurityLevel.Signed)).toContain('Signed');
    expect(getSecurityLevelDescription(SecurityLevel.Verified)).toContain('Verified');
    expect(getSecurityLevelDescription(SecurityLevel.Protected)).toContain('Protected');
    expect(getSecurityLevelDescription(SecurityLevel.Sensitive)).toContain('Sensitive');
    expect(getSecurityLevelDescription(SecurityLevel.Critical)).toContain('Critical');
  });

  it('includes biometric in Critical description', () => {
    expect(getSecurityLevelDescription(SecurityLevel.Critical)).toContain('biometric');
  });

  it('includes audit in Sensitive description', () => {
    expect(getSecurityLevelDescription(SecurityLevel.Sensitive)).toContain('audit');
  });
});
