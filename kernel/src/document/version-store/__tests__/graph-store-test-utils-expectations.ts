import type {
  VersionGraphCommitPageResult,
  VersionGraphReadHeadResult,
  VersionGraphReadRefResult,
  VersionGraphWriteResult,
} from '../graph';

export function expectGraphSuccess(
  result: VersionGraphWriteResult,
): asserts result is Extract<VersionGraphWriteResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected graph write success: ${result.diagnostics[0]?.code}`);
  }
}

export function expectGraphFailed(
  result: VersionGraphWriteResult,
): asserts result is Extract<VersionGraphWriteResult, { status: 'failed' }> {
  expect(result.status).toBe('failed');
  if (result.status !== 'failed') {
    throw new Error('expected graph write failure');
  }
}

export function expectReadHeadSuccess(
  result: VersionGraphReadHeadResult,
): asserts result is Extract<VersionGraphReadHeadResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected readHead success: ${result.diagnostics[0]?.code}`);
  }
}

export function expectReadHeadDegraded(
  result: VersionGraphReadHeadResult,
): asserts result is Extract<VersionGraphReadHeadResult, { status: 'degraded' }> {
  expect(result.status).toBe('degraded');
  if (result.status !== 'degraded') {
    throw new Error('expected readHead degraded result');
  }
}

export function expectReadRefSuccess(
  result: VersionGraphReadRefResult,
): asserts result is Extract<VersionGraphReadRefResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected readRef success: ${result.diagnostics[0]?.code}`);
  }
}

export function expectReadRefDegraded(
  result: VersionGraphReadRefResult,
): asserts result is Extract<VersionGraphReadRefResult, { status: 'degraded' }> {
  expect(result.status).toBe('degraded');
  if (result.status !== 'degraded') {
    throw new Error('expected readRef degraded result');
  }
}

export function expectListSuccess(
  result: VersionGraphCommitPageResult,
): asserts result is Extract<VersionGraphCommitPageResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected listCommits success: ${result.diagnostics[0]?.code}`);
  }
}

export function expectListFailed(
  result: VersionGraphCommitPageResult,
): asserts result is Extract<VersionGraphCommitPageResult, { status: 'failed' }> {
  expect(result.status).toBe('failed');
  if (result.status !== 'failed') {
    throw new Error('expected listCommits failure');
  }
}
