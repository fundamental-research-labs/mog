import type { DocumentContext } from '../../context';
import { createWorkbookVersionCommitService } from '../../document/version-store/commit-service';
import type { WorkbookVersioningConfig } from './types';

type MutableVersioningContext = DocumentContext & {
  versioning?: unknown;
};

export function attachWorkbookVersioning(
  ctx: DocumentContext,
  config: WorkbookVersioningConfig,
): void {
  const writeService =
    config.writeService ??
    (config.provider
      ? createWorkbookVersionCommitService({
          provider: config.provider,
          captureNormalCommit: config.captureNormalCommit,
        })
      : undefined);
  if (!writeService) return;

  const runtime = ctx as MutableVersioningContext;
  const existing = isRecord(runtime.versioning) ? runtime.versioning : {};
  runtime.versioning = {
    ...existing,
    ...(config.provider ? { provider: config.provider } : {}),
    writeService,
    readService: existing.readService ?? writeService,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
