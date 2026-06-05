import { jest } from '@jest/globals';

type NodeModuleExports = typeof import('node:module');

const actualNodeModule = jest.requireActual<NodeModuleExports>('node:module');

async function importNodeHeadlessHost() {
  return import('../src/host-adapters/node-headless-host');
}

function mockNodeModule(createRequire: NodeModuleExports['createRequire']): void {
  jest.unstable_mockModule<NodeModuleExports>('node:module', () => ({
    ...actualNodeModule,
    createRequire,
  }));
}

describe('node headless host import laziness', () => {
  afterEach(() => {
    jest.unstable_unmockModule('node:module');
    jest.resetModules();
  });

  it('does not create require during module import', async () => {
    jest.resetModules();
    const createRequire = jest.fn(actualNodeModule.createRequire);
    mockNodeModule(createRequire as NodeModuleExports['createRequire']);

    const host = await importNodeHeadlessHost();

    expect(createRequire).not.toHaveBeenCalled();
    expect(typeof host.loadNodeSdkNapiAddon).toBe('function');
  });

  it('creates require when the N-API addon path is loaded', async () => {
    jest.resetModules();
    const addon = {
      nativeProbe() {
        return undefined;
      },
    };
    const requireFromHere = jest.fn(() => addon);
    const createRequire = jest.fn(() => requireFromHere as unknown as NodeRequire);
    mockNodeModule(createRequire as NodeModuleExports['createRequire']);

    const { loadNodeSdkNapiAddon } = await importNodeHeadlessHost();
    const loaded = loadNodeSdkNapiAddon();

    expect(createRequire).toHaveBeenCalledTimes(1);
    expect(createRequire).toHaveBeenCalledWith(expect.any(String));
    expect(requireFromHere).toHaveBeenCalledTimes(1);
    expect(requireFromHere).toHaveBeenCalledWith(expect.stringMatching(/^@mog-sdk\//));
    expect(loaded).toBe(addon);
  });
});
