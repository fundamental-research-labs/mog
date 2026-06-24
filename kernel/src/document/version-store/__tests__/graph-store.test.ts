import {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  createInMemoryVersionGraphStore,
} from '../graph';
import {
  NAMESPACE,
  expectGraphSuccess,
  expectReadHeadDegraded,
  expectReadHeadSuccess,
  expectReadRefDegraded,
  expectReadRefSuccess,
  graphInput,
  refVersion,
} from './graph-store-test-utils';

describe('InMemoryVersionGraphStore initialization', () => {
  it('returns degraded read diagnostics before main is initialized', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });

    const head = await graph.readHead();
    expectReadHeadDegraded(head);
    expect(head.head).toBeNull();
    expect(head.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_GRAPH_UNINITIALIZED',
        operation: 'readHead',
        refName: VERSION_GRAPH_MAIN_REF,
      }),
    ]);

    const symbolic = await graph.readRef(VERSION_GRAPH_HEAD_REF);
    expectReadRefDegraded(symbolic);
    expect(symbolic.ref).toBeNull();
    expect(symbolic.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_GRAPH_UNINITIALIZED',
        operation: 'readRef',
        refName: VERSION_GRAPH_MAIN_REF,
      }),
    ]);

    const main = await graph.readRef(VERSION_GRAPH_MAIN_REF);
    expectReadRefDegraded(main);
    expect(main.ref).toBeNull();
    expect(main.diagnostics[0]).toMatchObject({
      code: 'VERSION_GRAPH_UNINITIALIZED',
      operation: 'readRef',
    });
  });

  it('initializes a graph with a root commit and refs/heads/main', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);

    expect(initialized.main).toMatchObject({
      name: VERSION_GRAPH_MAIN_REF,
      commitId: initialized.commit.id,
      revision: refVersion('0'),
    });
    expect(initialized.commit.payload.parentCommitIds).toEqual([]);

    const closure = await graph.readCommitClosure(initialized.commit.id);
    expect(closure.status).toBe('success');
    if (closure.status !== 'success') throw new Error('expected closure success');
    expect(closure.commits.map((commitRecord) => commitRecord.id)).toEqual([initialized.commit.id]);
  });

  it('reads HEAD and refs/heads/main after initialization', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);

    const head = await graph.readHead();
    expectReadHeadSuccess(head);
    expect(head.head).toEqual({
      id: initialized.commit.id,
      refName: VERSION_GRAPH_MAIN_REF,
      resolvedFrom: VERSION_GRAPH_HEAD_REF,
      refRevision: initialized.main.revision,
    });
    expect(head.main).toEqual(initialized.main);

    const symbolic = await graph.readRef(VERSION_GRAPH_HEAD_REF);
    expectReadRefSuccess(symbolic);
    expect(symbolic.ref).toEqual({
      name: VERSION_GRAPH_HEAD_REF,
      target: VERSION_GRAPH_MAIN_REF,
      revision: initialized.main.revision,
    });

    const main = await graph.readRef(VERSION_GRAPH_MAIN_REF);
    expectReadRefSuccess(main);
    expect(main.ref).toEqual(initialized.main);
  });

  it('is idempotent when the same root commit is initialized again', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const input = await graphInput('root');

    const first = await graph.initializeGraph(input);
    const second = await graph.initializeGraph(input);

    expectGraphSuccess(first);
    expectGraphSuccess(second);
    expect(second.commit.id).toBe(first.commit.id);
    expect(second.main).toEqual(first.main);
  });
});
