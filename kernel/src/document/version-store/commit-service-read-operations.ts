import type { VersionGraphListCommitsOptions } from './graph';
import { openVisibleVersionGraph } from './commit-service-open-graph';
import type {
  WorkbookVersionCommitServiceListCommitsResult,
  WorkbookVersionCommitServiceReadHeadResult,
  WorkbookVersionCommitServiceReadRefResult,
} from './commit-service-types';
import type { VersionStoreProvider } from './provider';

export async function readWorkbookVersionHead(
  provider: VersionStoreProvider,
): Promise<WorkbookVersionCommitServiceReadHeadResult> {
  const opened = await openVisibleVersionGraph(provider, 'readHead');
  if (!opened.ok) {
    return { status: 'degraded', head: null, diagnostics: opened.diagnostics };
  }
  return opened.graph.readHead();
}

export async function readWorkbookVersionRef(
  provider: VersionStoreProvider,
  name: string,
): Promise<WorkbookVersionCommitServiceReadRefResult> {
  const opened = await openVisibleVersionGraph(provider, 'readRef');
  if (!opened.ok) {
    return { status: 'degraded', ref: null, diagnostics: opened.diagnostics };
  }
  return opened.graph.readRef(name);
}

export async function listWorkbookVersionCommits(
  provider: VersionStoreProvider,
  options: VersionGraphListCommitsOptions = {},
): Promise<WorkbookVersionCommitServiceListCommitsResult> {
  const opened = await openVisibleVersionGraph(provider, 'listCommits');
  if (!opened.ok) {
    return { status: 'failed', diagnostics: opened.diagnostics };
  }
  return opened.graph.listCommits(options);
}
