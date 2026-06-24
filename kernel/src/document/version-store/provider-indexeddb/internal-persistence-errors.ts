import type { WorkbookCommitId } from '../object-digest';
import type { RefRecord, RefVersion } from '../refs/ref-store';

export class RefCasConflictError extends Error {
  readonly expectedHead?: WorkbookCommitId;
  readonly expectedRefVersion: RefVersion;
  readonly actualHead?: WorkbookCommitId;
  readonly actualRefVersion?: RefVersion;
  readonly actualRefState: 'missing' | RefRecord['state'];

  constructor(input: {
    readonly expectedHead?: WorkbookCommitId;
    readonly expectedRefVersion: RefVersion;
    readonly actualHead?: WorkbookCommitId;
    readonly actualRefVersion?: RefVersion;
    readonly actualRefState: 'missing' | RefRecord['state'];
  }) {
    super('IndexedDB version graph ref CAS conflict.');
    this.name = 'RefCasConflictError';
    this.expectedHead = input.expectedHead;
    this.expectedRefVersion = input.expectedRefVersion;
    this.actualHead = input.actualHead;
    this.actualRefVersion = input.actualRefVersion;
    this.actualRefState = input.actualRefState;
  }
}

export class RefAlreadyExistsError extends Error {
  readonly refName: string;

  constructor(refName: string) {
    super('IndexedDB version graph ref already exists.');
    this.name = 'RefAlreadyExistsError';
    this.refName = refName;
  }
}

export class RefStoreManifestConflictError extends Error {
  readonly expectedRefStoreNextGeneratedId?: number;
  readonly actualRefStoreNextGeneratedId?: number | null;
  readonly expectedRefStoreLiveRefCount?: number;
  readonly actualRefStoreLiveRefCount?: number | null;

  constructor(input: {
    readonly expectedRefStoreNextGeneratedId?: number;
    readonly actualRefStoreNextGeneratedId?: number | null;
    readonly expectedRefStoreLiveRefCount?: number;
    readonly actualRefStoreLiveRefCount?: number | null;
  }) {
    super('IndexedDB version graph ref manifest CAS conflict.');
    this.name = 'RefStoreManifestConflictError';
    Object.assign(this, input);
  }
}
