import type { VersionMainRefName } from '@mog-sdk/contracts/api';
import { VERSION_SEMANTIC_DIFF_RAW_PUBLIC_DOMAIN_IDS } from '@mog-sdk/contracts/versioning';

export const VERSION_HEAD_REF = 'HEAD';
export const VERSION_MAIN_REF = 'refs/heads/main' satisfies VersionMainRefName;
export const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;

export const VERSION_DIFF_OPTION_KEYS = new Set([
  'pageSize',
  'pageToken',
  'includeDerivedImpact',
  'includeDiagnostics',
]);
export const VERSION_COMMIT_SELECTOR_KEYS = new Set(['kind', 'id']);
export const VERSION_REF_SELECTOR_KEYS = new Set(['kind', 'name']);

export const RAW_PUBLIC_DIFF_DOMAINS: ReadonlySet<string> = new Set<string>(
  VERSION_SEMANTIC_DIFF_RAW_PUBLIC_DOMAIN_IDS,
);
export const REDACTED_VALUE_REASONS = new Set([
  'permission-denied',
  'redaction-policy',
  'historical-acl-unavailable',
]);
