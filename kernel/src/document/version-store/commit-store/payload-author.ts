import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { WorkbookCommitStoreDiagnostic } from './types';
import { invalidPayloadDiagnostic } from './payload-diagnostics';
import { isPlainRecord } from './payload-guards';
import { parseOptionalString, parseString } from './payload-scalars';

export function parseVersionAuthor(
  value: unknown,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): VersionAuthor | undefined {
  if (!isPlainRecord(value)) {
    diagnostics.push(invalidPayloadDiagnostic(`${path}`, 'Commit author must be an object.'));
    return undefined;
  }

  const unsupportedKey = Object.keys(value).find(
    (key) => !['authorId', 'actorKind', 'displayName', 'clientId', 'sessionId'].includes(key),
  );
  if (unsupportedKey !== undefined) {
    diagnostics.push(
      invalidPayloadDiagnostic(
        `${path}.${unsupportedKey}`,
        'Commit author has an unsupported field.',
      ),
    );
    return undefined;
  }

  const authorId = parseString(value.authorId, `${path}.authorId`, diagnostics);
  const actorKind = parseVersionActorKind(value.actorKind, `${path}.actorKind`, diagnostics);
  const displayName = parseOptionalString(value.displayName, `${path}.displayName`, diagnostics);
  const clientId = parseOptionalString(value.clientId, `${path}.clientId`, diagnostics);
  const sessionId = parseOptionalString(value.sessionId, `${path}.sessionId`, diagnostics);

  if (authorId === undefined || actorKind === undefined) {
    return undefined;
  }

  return {
    authorId,
    actorKind,
    ...(displayName === undefined ? {} : { displayName }),
    ...(clientId === undefined ? {} : { clientId }),
    ...(sessionId === undefined ? {} : { sessionId }),
  };
}

function parseVersionActorKind(
  value: unknown,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): VersionAuthor['actorKind'] | undefined {
  if (
    value === 'user' ||
    value === 'service' ||
    value === 'system' ||
    value === 'migration' ||
    value === 'automation'
  ) {
    return value;
  }
  diagnostics.push(invalidPayloadDiagnostic(path, 'Commit author actorKind is invalid.'));
  return undefined;
}
