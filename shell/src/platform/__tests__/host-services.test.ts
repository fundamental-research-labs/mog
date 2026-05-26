import { createShellHostServices } from '../host-services';

describe('ShellHostServices', () => {
  describe('creation with minimal deps', () => {
    it('creates services with no deps', () => {
      const services = createShellHostServices({});
      expect(services.routing).toBeDefined();
      expect(services.commands).toBeDefined();
      expect(services.resources).toBeDefined();
      expect(services.capabilities).toBeDefined();
      expect(services.clipboard).toBeDefined();
      expect(services.dialogs).toBeDefined();
      expect(services.notifications).toBeDefined();
      expect(services.storage).toBeDefined();
      expect(services.telemetry).toBeDefined();
      expect(services.focus).toBeDefined();
    });
  });

  describe('routing', () => {
    it('delegates navigate to provided routing dep', () => {
      const navigate = jest.fn();
      const services = createShellHostServices({
        routing: { navigate, getCurrentPath: () => '/test' },
      });

      services.routing.navigate('/new-path');
      expect(navigate).toHaveBeenCalledWith('/new-path');
    });

    it('returns current path from routing dep', () => {
      const services = createShellHostServices({
        routing: { navigate: jest.fn(), getCurrentPath: () => '/current' },
      });
      expect(services.routing.getCurrentPath()).toBe('/current');
    });

    it('returns "/" when no routing dep is provided', () => {
      const services = createShellHostServices({});
      expect(services.routing.getCurrentPath()).toBe('/');
    });

    it('navigate is a no-op when no routing dep is provided', () => {
      const services = createShellHostServices({});
      // Should not throw
      services.routing.navigate('/anywhere');
    });
  });

  describe('commands', () => {
    it('registers and executes a command', async () => {
      const services = createShellHostServices({});
      const handler = jest.fn();

      services.commands.register('test.cmd', handler);
      await services.commands.execute('test.cmd');

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('isAvailable returns true for registered commands', () => {
      const services = createShellHostServices({});
      services.commands.register('test.cmd', () => {});

      expect(services.commands.isAvailable('test.cmd')).toBe(true);
      expect(services.commands.isAvailable('other.cmd')).toBe(false);
    });

    it('unregisters a command', () => {
      const services = createShellHostServices({});
      services.commands.register('test.cmd', () => {});
      services.commands.unregister('test.cmd');

      expect(services.commands.isAvailable('test.cmd')).toBe(false);
    });

    it('throws when executing an unknown command', async () => {
      const services = createShellHostServices({});
      await expect(services.commands.execute('nonexistent')).rejects.toThrow(/Command not found/);
    });
  });

  describe('resources', () => {
    it('returns provided bindings', () => {
      const bindings = [
        { resourceKind: 'mog.test.a', resourceId: 'a1', accessMode: 'read' as const },
        { resourceKind: 'mog.test.b', resourceId: 'b1', accessMode: 'write' as const },
      ];
      const services = createShellHostServices({ bindings });

      expect(services.resources.getBindings()).toEqual(bindings);
    });

    it('getBinding returns matching binding', () => {
      const bindings = [
        { resourceKind: 'mog.test.a', resourceId: 'a1', accessMode: 'read' as const },
      ];
      const services = createShellHostServices({ bindings });

      expect(services.resources.getBinding('mog.test.a')).toEqual(bindings[0]);
      expect(services.resources.getBinding('mog.test.b')).toBeUndefined();
    });

    it('returns empty bindings when none provided', () => {
      const services = createShellHostServices({});
      expect(services.resources.getBindings()).toEqual([]);
    });
  });

  describe('capabilities', () => {
    it('checks capability membership', () => {
      const services = createShellHostServices({
        capabilities: ['clipboard.read', 'clipboard.write'],
      });

      expect(services.capabilities.has('clipboard.read')).toBe(true);
      expect(services.capabilities.has('network')).toBe(false);
    });

    it('lists all capabilities', () => {
      const caps = ['clipboard.read', 'clipboard.write'];
      const services = createShellHostServices({ capabilities: caps });

      expect(services.capabilities.list()).toEqual(caps);
    });
  });

  describe('notifications', () => {
    it('delegates to provided notification service', () => {
      const info = jest.fn();
      const warn = jest.fn();
      const error = jest.fn();
      const services = createShellHostServices({
        notifications: { info, warn, error },
      });

      services.notifications.info('hello');
      services.notifications.warn('careful');
      services.notifications.error('oops');

      expect(info).toHaveBeenCalledWith('hello');
      expect(warn).toHaveBeenCalledWith('careful');
      expect(error).toHaveBeenCalledWith('oops');
    });

    it('is a no-op when no notification dep provided', () => {
      const services = createShellHostServices({});
      // Should not throw
      services.notifications.info('test');
      services.notifications.warn('test');
      services.notifications.error('test');
    });
  });

  describe('storage', () => {
    it('get/set/delete cycle', () => {
      const services = createShellHostServices({});

      expect(services.storage.get('key')).toBeUndefined();

      services.storage.set('key', 'value');
      expect(services.storage.get('key')).toBe('value');

      services.storage.delete('key');
      expect(services.storage.get('key')).toBeUndefined();
    });

    it('lists keys', () => {
      const services = createShellHostServices({});
      services.storage.set('a', '1');
      services.storage.set('b', '2');

      expect(services.storage.keys()).toEqual(expect.arrayContaining(['a', 'b']));
      expect(services.storage.keys()).toHaveLength(2);
    });
  });

  describe('telemetry', () => {
    it('track is a no-op (does not throw)', () => {
      const services = createShellHostServices({});
      services.telemetry.track('event', { foo: 'bar' });
    });
  });

  describe('focus', () => {
    it('tracks focus state', () => {
      const services = createShellHostServices({});

      expect(services.focus.hasFocus('el-1')).toBe(false);

      services.focus.requestFocus('el-1');
      expect(services.focus.hasFocus('el-1')).toBe(true);

      services.focus.releaseFocus('el-1');
      expect(services.focus.hasFocus('el-1')).toBe(false);
    });
  });
});
