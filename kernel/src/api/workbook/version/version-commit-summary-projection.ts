import type {
  VersionAnnotationText,
  WorkbookCommitAnnotationSummary,
} from '@mog-sdk/contracts/api';

export function mapWorkbookCommitAnnotationSummary(
  value: unknown,
): WorkbookCommitAnnotationSummary | undefined {
  if (!isRecord(value)) return undefined;
  const message = mapAnnotationText(value.message);
  const title = mapAnnotationText(value.title);
  const tags = Array.isArray(value.tags)
    ? value.tags.map(mapAnnotationText).filter((tag): tag is VersionAnnotationText => Boolean(tag))
    : undefined;
  if (!message && !title && (!tags || tags.length === 0)) return undefined;
  return {
    ...(message ? { message } : {}),
    ...(title ? { title } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
  };
}

function mapAnnotationText(value: unknown): VersionAnnotationText | undefined {
  if (!isRecord(value)) return undefined;
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
  return undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
