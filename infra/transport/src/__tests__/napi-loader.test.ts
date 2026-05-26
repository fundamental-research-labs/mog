import { AddonNotFoundError, loadNapiAddon, tryLoadNapiAddon } from '../napi-loader';

describe('napi-loader', () => {
  const expectAddonNotFound = (err: unknown) => {
    expect(err).toBeInstanceOf(AddonNotFoundError);
    expect((err as AddonNotFoundError).addonName).toBe('compute-core');
    expect((err as AddonNotFoundError).name).toBe('AddonNotFoundError');
  };

  // ============================================================
  // loadNapiAddon (throwing variant)
  // ============================================================

  describe('loadNapiAddon', () => {
    it('should load the platform addon or throw AddonNotFoundError', () => {
      try {
        const addon = loadNapiAddon();
        expect(typeof addon.ComputeEngine).toBe('function');
      } catch (err) {
        expectAddonNotFound(err);
      }
    });

    it('should expose compute-core addonName when the platform addon is missing', () => {
      try {
        const addon = loadNapiAddon();
        expect(typeof addon.ComputeEngine).toBe('function');
      } catch (err) {
        expectAddonNotFound(err);
      }
    });

    it('should throw with actionable install instructions when the platform addon is missing', () => {
      try {
        const addon = loadNapiAddon();
        expect(typeof addon.ComputeEngine).toBe('function');
      } catch (err) {
        expectAddonNotFound(err);
        const message = (err as AddonNotFoundError).message;
        expect(message).toContain('Install the platform package');
        expect(message).toContain('npm add @mog-sdk/');
      }
    });

    it('should set the AddonNotFoundError name when the platform addon is missing', () => {
      try {
        const addon = loadNapiAddon();
        expect(typeof addon.ComputeEngine).toBe('function');
      } catch (err) {
        expectAddonNotFound(err);
      }
    });
  });

  // ============================================================
  // tryLoadNapiAddon (silent variant)
  // ============================================================

  describe('tryLoadNapiAddon', () => {
    it('should return the platform addon when available and undefined when missing', () => {
      const result = tryLoadNapiAddon();
      if (result) {
        expect(typeof result.ComputeEngine).toBe('function');
      } else {
        expect(result).toBeUndefined();
      }
    });

    it('should not throw while probing addon availability', () => {
      expect(() => tryLoadNapiAddon()).not.toThrow();
    });
  });
});
