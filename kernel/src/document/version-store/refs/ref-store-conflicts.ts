import type { WorkbookCommitId } from '../object-digest';
import type { RefName } from './ref-name';
import { diagnostic, failure } from './ref-store-diagnostics';
import { cloneRefVersion } from './ref-store-revisions';
import type { LiveRefRecord, RefFailureResult, RefVersion } from './ref-store-types';

export function refAlreadyExists(record: LiveRefRecord): RefFailureResult {
  const diagnostics = [
    diagnostic(
      'refAlreadyExists',
      `Ref ${record.name} already exists.`,
      record.name,
      record.targetCommitId,
      record.refVersion,
      record.refIncarnationId,
    ),
  ];
  return failure('refAlreadyExists', `Ref ${record.name} already exists.`, diagnostics, {
    code: 'refAlreadyExists',
    actualHead: record.targetCommitId,
    actualRefVersion: cloneRefVersion(record.refVersion),
    actualRefIncarnationId: record.refIncarnationId,
  });
}

export function refNotFound(name: RefName): RefFailureResult {
  const diagnostics = [diagnostic('refNotFound', `Ref ${name} does not exist.`, name)];
  return failure('refNotFound', `Ref ${name} does not exist.`, diagnostics);
}

export function protectedRef(name: RefName, action: 'update' | 'delete'): RefFailureResult {
  const diagnostics = [
    diagnostic('protectedRef', `Protected ref ${name} cannot be ${action}d.`, name),
  ];
  return failure('protectedRef', `Protected ref ${name} cannot be ${action}d.`, diagnostics);
}

export function expectedHeadMismatch(
  record: LiveRefRecord,
  expectedHead: WorkbookCommitId,
): RefFailureResult {
  const diagnostics = [
    diagnostic(
      'expectedHeadMismatch',
      `Ref ${record.name} is at a different head than expected.`,
      record.name,
      record.targetCommitId,
      record.refVersion,
      record.refIncarnationId,
    ),
  ];
  return failure(
    'expectedHeadMismatch',
    `Ref ${record.name} is at a different head than expected.`,
    diagnostics,
    {
      code: 'expectedHeadMismatch',
      expectedHead,
      actualHead: record.targetCommitId,
      actualRefVersion: cloneRefVersion(record.refVersion),
      actualRefIncarnationId: record.refIncarnationId,
    },
  );
}

export function expectedRefVersionMismatch(
  record: LiveRefRecord,
  expectedRefVersion: RefVersion,
): RefFailureResult {
  const diagnostics = [
    diagnostic(
      'expectedRefVersionMismatch',
      `Ref ${record.name} is at a different version than expected.`,
      record.name,
      record.targetCommitId,
      record.refVersion,
      record.refIncarnationId,
    ),
  ];
  return failure(
    'expectedRefVersionMismatch',
    `Ref ${record.name} is at a different version than expected.`,
    diagnostics,
    {
      code: 'expectedRefVersionMismatch',
      expectedRefVersion: cloneRefVersion(expectedRefVersion),
      actualRefVersion: cloneRefVersion(record.refVersion),
      actualHead: record.targetCommitId,
      actualRefIncarnationId: record.refIncarnationId,
    },
  );
}

export function unsupportedRefMetadataMutation(record: LiveRefRecord): RefFailureResult {
  const diagnostics = [
    diagnostic(
      'unsupportedRefMetadataMutation',
      'Ref metadata-only mutation is not supported in VC-05.',
      record.name,
      record.targetCommitId,
      record.refVersion,
    ),
  ];
  return failure(
    'unsupportedRefMetadataMutation',
    'Ref metadata-only mutation is not supported in VC-05.',
    diagnostics,
  );
}
