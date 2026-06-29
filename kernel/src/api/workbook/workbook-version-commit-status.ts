export interface WorkbookVersionCommitStatusGuard {
  beginCommit(): void;
  endCommit(): void;
}

export interface WorkbookVersionCommitStatusCoordinator {
  readonly commitInProgress: boolean;
  readonly guard: WorkbookVersionCommitStatusGuard;
}

export function createWorkbookVersionCommitStatusCoordinator(options: {
  readonly notifyStatusChanged: () => void;
}): WorkbookVersionCommitStatusCoordinator {
  return new WorkbookVersionCommitStatusCoordinatorImpl(options);
}

class WorkbookVersionCommitStatusCoordinatorImpl implements WorkbookVersionCommitStatusCoordinator {
  private activeCommitCount = 0;

  readonly guard: WorkbookVersionCommitStatusGuard = {
    beginCommit: () => this.beginCommit(),
    endCommit: () => this.endCommit(),
  };

  constructor(private readonly options: { readonly notifyStatusChanged: () => void }) {}

  get commitInProgress(): boolean {
    return this.activeCommitCount > 0;
  }

  private beginCommit(): void {
    const wasInProgress = this.commitInProgress;
    this.activeCommitCount += 1;
    if (!wasInProgress) this.options.notifyStatusChanged();
  }

  private endCommit(): void {
    if (this.activeCommitCount === 0) return;
    this.activeCommitCount -= 1;
    if (!this.commitInProgress) this.options.notifyStatusChanged();
  }
}
