import type { VersionCommitExpectedHead, WorkbookCommitId } from '@mog-sdk/contracts/api';

import type { VersionPanelDiagnostic } from './VersionActionStatus';
import type { VersionMergeTarget } from './merge';
import { readVersionResult, type VersionHistoryWorkbook } from './version-history-panel-data';

const VERSION_MAIN_REF = 'refs/heads/main';
const VERSION_HEAD_REF = 'HEAD';

export async function readCurrentMergeExpectedTargetHead(
  workbook: VersionHistoryWorkbook,
  target: VersionMergeTarget,
  previewOurs: WorkbookCommitId,
): Promise<
  | { readonly ok: true; readonly value: VersionCommitExpectedHead }
  | { readonly ok: false; readonly diagnostic: VersionPanelDiagnostic }
> {
  const targetRef = target.refName;
  if (!targetRef) {
    return {
      ok: false,
      diagnostic: {
        code: 'VERSION_UI_MERGE_TARGET_REF_UNAVAILABLE',
        severity: 'warning',
        message: 'Current branch ref is unavailable.',
      },
    };
  }

  const read = await readVersionResult('VERSION_UI_MERGE_TARGET_REF_FAILED', () =>
    workbook.version.readRef(targetRef),
  );
  if (!read.ok) return read;

  const current = read.value.status === 'success' ? read.value.ref : undefined;
  if (
    !current ||
    !('commitId' in current) ||
    current.name !== targetRef ||
    current.commitId !== previewOurs ||
    current.commitId !== target.commitId
  ) {
    return {
      ok: false,
      diagnostic: {
        code: 'VERSION_UI_MERGE_TARGET_HEAD_CHANGED',
        severity: 'warning',
        message: 'Current branch moved. Refresh before merging.',
      },
    };
  }

  return {
    ok: true,
    value: await readExpectedTargetHeadWithSymbolicRevision(
      workbook,
      targetRef,
      current.commitId,
      current.revision,
    ),
  };
}

async function readExpectedTargetHeadWithSymbolicRevision(
  workbook: VersionHistoryWorkbook,
  targetRef: string,
  commitId: WorkbookCommitId,
  revision: VersionCommitExpectedHead['revision'],
): Promise<VersionCommitExpectedHead> {
  if (targetRef !== VERSION_MAIN_REF) return { commitId, revision };

  const read = await readVersionResult('VERSION_UI_MERGE_SYMBOLIC_HEAD_REF_FAILED', () =>
    workbook.version.readRef(VERSION_HEAD_REF),
  );
  if (!read.ok || read.value.status !== 'success') return { commitId, revision };

  const head = read.value.ref;
  if (head.name !== VERSION_HEAD_REF || head.target !== targetRef) return { commitId, revision };

  return {
    commitId,
    revision,
    symbolicHeadRevision: head.revision,
  };
}
