import { KernelError, isKernelError } from '..';
import type { CapabilityScope } from '../../services/capabilities/scope';
import {
  CapabilityDeniedError,
  CapabilityError,
  CapabilityExpiredError,
  CapabilityRequiresAuthError,
  CapabilityScopeError,
  InvalidScopeError,
  UnboundedWildcardError,
  authRequired,
  capabilityDenied,
  capabilityExpired,
  isCapabilityDeniedError,
  isCapabilityError,
  isCapabilityExpiredError,
  isCapabilityRequiresAuthError,
  isCapabilityScopeError,
  isInvalidScopeError,
  isUnboundedWildcardError,
  scopeMismatch,
} from '../capability';

describe('Capability Errors', () => {
  describe('CapabilityError (base)', () => {
    it('constructs with code, message, appId, and capability', () => {
      const error = new CapabilityDeniedError('my-app', 'tables:read');
      expect(error.code).toBe('CAP_DENIED');
      expect(error.appId).toBe('my-app');
      expect(error.capability).toBe('tables:read');
      expect(error.timestamp).toBeLessThanOrEqual(Date.now());
      expect(error.timestamp).toBeGreaterThan(Date.now() - 1000);
    });

    it('is an instance of KernelError and Error', () => {
      const error = new CapabilityDeniedError('app', 'tables:read');
      expect(error).toBeInstanceOf(KernelError);
      expect(error).toBeInstanceOf(CapabilityError);
      expect(error).toBeInstanceOf(Error);
    });

    it('includes appId and capability in context', () => {
      const error = new CapabilityDeniedError('my-app', 'tables:read');
      expect(error.context.appId).toBe('my-app');
      expect(error.context.capability).toBe('tables:read');
    });
  });

  describe('CapabilityDeniedError', () => {
    it('creates with default options', () => {
      const error = new CapabilityDeniedError('app1', 'tables:write');
      expect(error.code).toBe('CAP_DENIED');
      expect(error.name).toBe('CapabilityDeniedError');
      expect(error.appId).toBe('app1');
      expect(error.capability).toBe('tables:write');
      expect(error.operation).toBeUndefined();
      expect(error.wasDenied).toBe(false);
      expect(error.message).toBe('App "app1" does not have capability "tables:write"');
      expect(error.suggestion).toContain('app manifest');
    });

    it('creates with operation', () => {
      const error = new CapabilityDeniedError('app1', 'tables:write', {
        operation: 'setCellValue',
      });
      expect(error.operation).toBe('setCellValue');
      expect(error.message).toContain('setCellValue');
    });

    it('creates with wasDenied=true', () => {
      const error = new CapabilityDeniedError('app1', 'tables:write', {
        wasDenied: true,
      });
      expect(error.wasDenied).toBe(true);
      expect(error.suggestion).toContain('denied');
    });

    it('toJSON includes operation and wasDenied', () => {
      const error = new CapabilityDeniedError('app1', 'tables:write', {
        operation: 'setCellValue',
        wasDenied: true,
      });
      const json = error.toJSON();
      expect(json.operation).toBe('setCellValue');
      expect(json.wasDenied).toBe(true);
      expect(json.suggestion).toBeDefined();
      expect(json.appId).toBe('app1');
      expect(json.capability).toBe('tables:write');
    });
  });

  describe('CapabilityScopeError', () => {
    it('creates with resource info', () => {
      const scope = 'table:contacts' as CapabilityScope;
      const error = new CapabilityScopeError('app1', 'tables:read', 'table', 'orders', scope);
      expect(error.code).toBe('CAP_SCOPE_MISMATCH');
      expect(error.name).toBe('CapabilityScopeError');
      expect(error.resourceType).toBe('table');
      expect(error.resourceId).toBe('orders');
      expect(error.grantedScope).toBe(scope);
      expect(error.message).toContain('scoped to');
      expect(error.message).toContain('table:orders');
      expect(error.suggestion).toContain('table:orders');
    });

    it('toJSON includes resource info', () => {
      const scope = 'table:contacts' as CapabilityScope;
      const error = new CapabilityScopeError('app1', 'tables:read', 'table', 'orders', scope);
      const json = error.toJSON();
      expect(json.resourceType).toBe('table');
      expect(json.resourceId).toBe('orders');
      expect(json.grantedScope).toBe('table:contacts');
      expect(json.appId).toBe('app1');
    });
  });

  describe('CapabilityExpiredError', () => {
    it('creates with expiredAt', () => {
      const expiredAt = Date.now() - 60000;
      const error = new CapabilityExpiredError('app1', 'credentials:use', expiredAt);
      expect(error.code).toBe('CAP_EXPIRED');
      expect(error.name).toBe('CapabilityExpiredError');
      expect(error.expiredAt).toBe(expiredAt);
      expect(error.message).toContain('expired');
      expect(error.suggestion).toContain('Re-authenticate');
    });

    it('toJSON includes expiredAt', () => {
      const expiredAt = Date.now() - 60000;
      const error = new CapabilityExpiredError('app1', 'credentials:use', expiredAt);
      const json = error.toJSON();
      expect(json.expiredAt).toBe(expiredAt);
      expect(json.appId).toBe('app1');
      expect(json.capability).toBe('credentials:use');
    });
  });

  describe('CapabilityRequiresAuthError', () => {
    it('creates with default authType (password)', () => {
      const error = new CapabilityRequiresAuthError('app1', 'credentials:use');
      expect(error.code).toBe('CAP_REQUIRES_AUTH');
      expect(error.name).toBe('CapabilityRequiresAuthError');
      expect(error.authType).toBe('password');
      expect(error.message).toContain('password');
      expect(error.suggestion).toContain('password');
    });

    it('creates with biometric authType', () => {
      const error = new CapabilityRequiresAuthError('app1', 'credentials:use', 'biometric');
      expect(error.authType).toBe('biometric');
      expect(error.message).toContain('biometric');
      expect(error.suggestion).toContain('biometric');
    });

    it('toJSON includes authType', () => {
      const error = new CapabilityRequiresAuthError('app1', 'credentials:use', 'biometric');
      const json = error.toJSON();
      expect(json.authType).toBe('biometric');
      expect(json.appId).toBe('app1');
    });
  });

  describe('InvalidScopeError', () => {
    it('creates with scope and reason', () => {
      const error = new InvalidScopeError('bad:scope:format', 'Too many colons');
      expect(error.code).toBe('CAP_INVALID_SCOPE');
      expect(error.name).toBe('InvalidScopeError');
      expect(error.scope).toBe('bad:scope:format');
      expect(error.message).toContain('bad:scope:format');
      expect(error.message).toContain('Too many colons');
      expect(error.suggestion).toContain('type:pattern');
    });

    it('is a KernelError but not a CapabilityError', () => {
      const error = new InvalidScopeError('bad', 'reason');
      expect(error).toBeInstanceOf(KernelError);
      expect(error).not.toBeInstanceOf(CapabilityError);
    });

    it('toJSON includes scope', () => {
      const error = new InvalidScopeError('bad', 'reason');
      const json = error.toJSON();
      expect(json.scope).toBe('bad');
      expect(json.suggestion).toContain('type:pattern');
    });
  });

  describe('UnboundedWildcardError', () => {
    it('creates with resourceType and requiredCapability', () => {
      const error = new UnboundedWildcardError('table', 'tables:readAll');
      expect(error.code).toBe('CAP_UNBOUNDED_WILDCARD');
      expect(error.name).toBe('UnboundedWildcardError');
      expect(error.resourceType).toBe('table');
      expect(error.requiredCapability).toBe('tables:readAll');
      expect(error.message).toContain('table:*');
      expect(error.message).toContain('tables:readAll');
      expect(error.suggestion).toContain('tables:readAll');
    });

    it('is a KernelError but not a CapabilityError', () => {
      const error = new UnboundedWildcardError('table', 'tables:readAll');
      expect(error).toBeInstanceOf(KernelError);
      expect(error).not.toBeInstanceOf(CapabilityError);
    });

    it('toJSON includes resourceType and requiredCapability', () => {
      const error = new UnboundedWildcardError('table', 'tables:readAll');
      const json = error.toJSON();
      expect(json.resourceType).toBe('table');
      expect(json.requiredCapability).toBe('tables:readAll');
    });
  });

  describe('isKernelError() for all capability errors', () => {
    it('returns true for CapabilityDeniedError', () => {
      expect(isKernelError(new CapabilityDeniedError('a', 'tables:read'))).toBe(true);
    });

    it('returns true for CapabilityScopeError', () => {
      const scope = 'table:x' as CapabilityScope;
      expect(isKernelError(new CapabilityScopeError('a', 'tables:read', 't', 'r', scope))).toBe(
        true,
      );
    });

    it('returns true for CapabilityExpiredError', () => {
      expect(isKernelError(new CapabilityExpiredError('a', 'tables:read', 0))).toBe(true);
    });

    it('returns true for CapabilityRequiresAuthError', () => {
      expect(isKernelError(new CapabilityRequiresAuthError('a', 'tables:read'))).toBe(true);
    });

    it('returns true for InvalidScopeError', () => {
      expect(isKernelError(new InvalidScopeError('x', 'bad'))).toBe(true);
    });

    it('returns true for UnboundedWildcardError', () => {
      expect(isKernelError(new UnboundedWildcardError('table', 'tables:readAll'))).toBe(true);
    });
  });

  describe('type guards', () => {
    const denied = new CapabilityDeniedError('a', 'tables:read');
    const scopeErr = new CapabilityScopeError(
      'a',
      'tables:read',
      'table',
      'x',
      'table:y' as CapabilityScope,
    );
    const expired = new CapabilityExpiredError('a', 'tables:read', 0);
    const authReq = new CapabilityRequiresAuthError('a', 'tables:read');
    const invalidScope = new InvalidScopeError('x', 'bad');
    const wildcard = new UnboundedWildcardError('table', 'tables:readAll');
    const plainError = new Error('not a capability error');

    it('isCapabilityError matches CapabilityError subclasses only', () => {
      expect(isCapabilityError(denied)).toBe(true);
      expect(isCapabilityError(scopeErr)).toBe(true);
      expect(isCapabilityError(expired)).toBe(true);
      expect(isCapabilityError(authReq)).toBe(true);
      // InvalidScopeError and UnboundedWildcardError extend KernelError directly
      expect(isCapabilityError(invalidScope)).toBe(false);
      expect(isCapabilityError(wildcard)).toBe(false);
      expect(isCapabilityError(plainError)).toBe(false);
    });

    it('isCapabilityDeniedError', () => {
      expect(isCapabilityDeniedError(denied)).toBe(true);
      expect(isCapabilityDeniedError(scopeErr)).toBe(false);
      expect(isCapabilityDeniedError(plainError)).toBe(false);
    });

    it('isCapabilityScopeError', () => {
      expect(isCapabilityScopeError(scopeErr)).toBe(true);
      expect(isCapabilityScopeError(denied)).toBe(false);
    });

    it('isCapabilityExpiredError', () => {
      expect(isCapabilityExpiredError(expired)).toBe(true);
      expect(isCapabilityExpiredError(denied)).toBe(false);
    });

    it('isCapabilityRequiresAuthError', () => {
      expect(isCapabilityRequiresAuthError(authReq)).toBe(true);
      expect(isCapabilityRequiresAuthError(denied)).toBe(false);
    });

    it('isInvalidScopeError', () => {
      expect(isInvalidScopeError(invalidScope)).toBe(true);
      expect(isInvalidScopeError(denied)).toBe(false);
    });

    it('isUnboundedWildcardError', () => {
      expect(isUnboundedWildcardError(wildcard)).toBe(true);
      expect(isUnboundedWildcardError(denied)).toBe(false);
    });
  });

  describe('factory functions', () => {
    it('capabilityDenied returns CapabilityDeniedError', () => {
      const error = capabilityDenied('app', 'tables:write', 'setCellValue');
      expect(error).toBeInstanceOf(CapabilityDeniedError);
      expect(error.operation).toBe('setCellValue');
    });

    it('capabilityDenied works without operation', () => {
      const error = capabilityDenied('app', 'tables:write');
      expect(error).toBeInstanceOf(CapabilityDeniedError);
      expect(error.operation).toBeUndefined();
    });

    it('scopeMismatch returns CapabilityScopeError', () => {
      const scope = 'table:contacts' as CapabilityScope;
      const error = scopeMismatch('app', 'tables:read', 'table', 'orders', scope);
      expect(error).toBeInstanceOf(CapabilityScopeError);
      expect(error.resourceType).toBe('table');
      expect(error.resourceId).toBe('orders');
      expect(error.grantedScope).toBe(scope);
    });

    it('capabilityExpired returns CapabilityExpiredError', () => {
      const ts = Date.now() - 5000;
      const error = capabilityExpired('app', 'credentials:use', ts);
      expect(error).toBeInstanceOf(CapabilityExpiredError);
      expect(error.expiredAt).toBe(ts);
    });

    it('authRequired returns CapabilityRequiresAuthError', () => {
      const error = authRequired('app', 'credentials:use', 'biometric');
      expect(error).toBeInstanceOf(CapabilityRequiresAuthError);
      expect(error.authType).toBe('biometric');
    });

    it('authRequired defaults to password', () => {
      const error = authRequired('app', 'credentials:use');
      expect(error.authType).toBe('password');
    });
  });

  describe('toJSON() includes appId and capability', () => {
    it('CapabilityDeniedError toJSON has appId and capability', () => {
      const json = new CapabilityDeniedError('my-app', 'tables:read').toJSON();
      expect(json.appId).toBe('my-app');
      expect(json.capability).toBe('tables:read');
      expect(json.code).toBe('CAP_DENIED');
      expect(json.name).toBe('CapabilityDeniedError');
      expect(json.timestamp).toBeDefined();
    });

    it('CapabilityExpiredError toJSON has appId and capability', () => {
      const json = new CapabilityExpiredError('my-app', 'credentials:use', 100).toJSON();
      expect(json.appId).toBe('my-app');
      expect(json.capability).toBe('credentials:use');
      expect(json.expiredAt).toBe(100);
    });
  });
});
