/**
 * CleanupManager Tests
 *
 * Tests for the CleanupManager class that manages cleanup functions.
 *
 */

import { jest } from '@jest/globals';

import { CleanupManager } from '../cleanup-manager';

describe('CleanupManager', () => {
  let consoleError: jest.SpyInstance;
  let consoleWarn: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });

  describe('register', () => {
    it('registers a cleanup function', () => {
      const manager = new CleanupManager();
      const cleanup = jest.fn();

      manager.register('test', cleanup);

      expect(manager.size).toBe(1);
      expect(manager.has('test')).toBe(true);
    });

    it('replaces existing cleanup and calls old one', () => {
      const manager = new CleanupManager();
      const cleanup1 = jest.fn();
      const cleanup2 = jest.fn();

      manager.register('test', cleanup1);
      manager.register('test', cleanup2);

      // Old cleanup should have been called during replacement
      expect(cleanup1).toHaveBeenCalledTimes(1);
      expect(cleanup2).not.toHaveBeenCalled();
      expect(manager.size).toBe(1);
    });

    it('handles error in replaced cleanup gracefully', () => {
      const manager = new CleanupManager();
      const cleanup1 = jest.fn(() => {
        throw new Error('cleanup1 error');
      });
      const cleanup2 = jest.fn();

      manager.register('test', cleanup1);
      manager.register('test', cleanup2); // Should not throw

      expect(cleanup1).toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("Error replacing cleanup 'test'"),
        expect.any(Error),
      );
      expect(manager.has('test')).toBe(true);
    });

    it('calls cleanup immediately if already disposed', () => {
      const manager = new CleanupManager();
      manager.dispose();

      const cleanup = jest.fn();
      manager.register('test', cleanup);

      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining("Attempted to register 'test' after disposal"),
      );
      expect(manager.size).toBe(0);
    });

    it('handles error in immediate cleanup after disposal', () => {
      const manager = new CleanupManager();
      manager.dispose();

      const cleanup = jest.fn(() => {
        throw new Error('immediate cleanup error');
      });
      manager.register('test', cleanup);

      expect(cleanup).toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("Error in immediate cleanup 'test'"),
        expect.any(Error),
      );
    });
  });

  describe('unregister', () => {
    it('unregisters and calls the cleanup', () => {
      const manager = new CleanupManager();
      const cleanup = jest.fn();

      manager.register('test', cleanup);
      const result = manager.unregister('test');

      expect(result).toBe(true);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(manager.has('test')).toBe(false);
      expect(manager.size).toBe(0);
    });

    it('returns false for non-existent key', () => {
      const manager = new CleanupManager();

      const result = manager.unregister('nonexistent');

      expect(result).toBe(false);
    });

    it('handles error in cleanup gracefully', () => {
      const manager = new CleanupManager();
      const cleanup = jest.fn(() => {
        throw new Error('unregister error');
      });

      manager.register('test', cleanup);
      const result = manager.unregister('test');

      expect(result).toBe(true);
      expect(cleanup).toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("Error unregistering 'test'"),
        expect.any(Error),
      );
      expect(manager.has('test')).toBe(false);
    });
  });

  describe('has', () => {
    it('returns true for registered key', () => {
      const manager = new CleanupManager();
      manager.register('test', () => {});

      expect(manager.has('test')).toBe(true);
    });

    it('returns false for unregistered key', () => {
      const manager = new CleanupManager();

      expect(manager.has('test')).toBe(false);
    });
  });

  describe('dispose', () => {
    it('calls all cleanups in reverse order (LIFO)', () => {
      const manager = new CleanupManager();
      const order: string[] = [];

      manager.register('first', () => order.push('first'));
      manager.register('second', () => order.push('second'));
      manager.register('third', () => order.push('third'));

      manager.dispose();

      expect(order).toEqual(['third', 'second', 'first']);
    });

    it('clears all cleanups after dispose', () => {
      const manager = new CleanupManager();
      manager.register('test', () => {});

      manager.dispose();

      expect(manager.size).toBe(0);
      expect(manager.isDisposed()).toBe(true);
    });

    it('is idempotent - multiple disposes have no effect', () => {
      const manager = new CleanupManager();
      const cleanup = jest.fn();

      manager.register('test', cleanup);
      manager.dispose();
      manager.dispose(); // Should be no-op

      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('handles errors gracefully and continues cleanup', () => {
      const manager = new CleanupManager();
      const order: string[] = [];

      manager.register('first', () => order.push('first'));
      manager.register('error', () => {
        throw new Error('cleanup error');
      });
      manager.register('third', () => order.push('third'));

      manager.dispose(); // Should not throw

      // All cleanups should run despite error
      expect(order).toEqual(['third', 'first']);
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("Error disposing 'error'"),
        expect.any(Error),
      );
    });
  });

  describe('size', () => {
    it('returns the number of registered cleanups', () => {
      const manager = new CleanupManager();

      expect(manager.size).toBe(0);

      manager.register('a', () => {});
      expect(manager.size).toBe(1);

      manager.register('b', () => {});
      expect(manager.size).toBe(2);

      manager.unregister('a');
      expect(manager.size).toBe(1);
    });
  });

  describe('isDisposed', () => {
    it('returns false before dispose', () => {
      const manager = new CleanupManager();

      expect(manager.isDisposed()).toBe(false);
    });

    it('returns true after dispose', () => {
      const manager = new CleanupManager();
      manager.dispose();

      expect(manager.isDisposed()).toBe(true);
    });
  });

  describe('getKeys', () => {
    it('returns all registered keys', () => {
      const manager = new CleanupManager();
      manager.register('alpha', () => {});
      manager.register('beta', () => {});
      manager.register('gamma', () => {});

      const keys = manager.getKeys();

      expect(keys).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('returns empty array when no cleanups registered', () => {
      const manager = new CleanupManager();

      expect(manager.getKeys()).toEqual([]);
    });

    it('returns empty array after dispose', () => {
      const manager = new CleanupManager();
      manager.register('test', () => {});
      manager.dispose();

      expect(manager.getKeys()).toEqual([]);
    });
  });
});
