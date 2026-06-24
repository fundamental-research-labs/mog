import type {
  VersionAnnotationText,
  WorkbookCommitAnnotationSummary,
} from '@mog-sdk/contracts/api';

import type { WorkbookCommitStoreDiagnostic } from './types';
import { invalidPayloadDiagnostic } from './payload-diagnostics';
import { isPlainRecord } from './payload-guards';

export function parseCommitAnnotation(
  value: unknown,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): WorkbookCommitAnnotationSummary | undefined {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) {
    diagnostics.push(invalidPayloadDiagnostic(path, 'Commit annotation must be an object.'));
    return undefined;
  }

  const unsupportedKey = Object.keys(value).find(
    (key) => !['message', 'title', 'tags'].includes(key),
  );
  if (unsupportedKey !== undefined) {
    diagnostics.push(
      invalidPayloadDiagnostic(
        `${path}.${unsupportedKey}`,
        'Commit annotation has an unsupported field.',
      ),
    );
  }

  const message = parseAnnotationText(value.message, `${path}.message`, diagnostics);
  const title = parseAnnotationText(value.title, `${path}.title`, diagnostics);
  const tags = parseAnnotationTags(value.tags, `${path}.tags`, diagnostics);
  if (!message && !title && (!tags || tags.length === 0)) return undefined;

  return {
    ...(message ? { message } : {}),
    ...(title ? { title } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
  };
}

function parseAnnotationTags(
  value: unknown,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): readonly VersionAnnotationText[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    diagnostics.push(invalidPayloadDiagnostic(path, 'Commit annotation tags must be an array.'));
    return undefined;
  }
  const tags = value
    .map((item, index) => parseAnnotationText(item, `${path}.${index}`, diagnostics))
    .filter((item): item is VersionAnnotationText => Boolean(item));
  return tags;
}

function parseAnnotationText(
  value: unknown,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): VersionAnnotationText | undefined {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) {
    diagnostics.push(invalidPayloadDiagnostic(path, 'Commit annotation text must be an object.'));
    return undefined;
  }

  if (value.kind === 'text' && typeof value.value === 'string') {
    return { kind: 'text', value: value.value };
  }

  if (
    value.kind === 'redacted' &&
    (value.reason === 'permission-denied' ||
      value.reason === 'redaction-policy' ||
      value.reason === 'historical-acl-unavailable')
  ) {
    return { kind: 'redacted', reason: value.reason };
  }

  diagnostics.push(invalidPayloadDiagnostic(path, 'Commit annotation text shape is invalid.'));
  return undefined;
}
