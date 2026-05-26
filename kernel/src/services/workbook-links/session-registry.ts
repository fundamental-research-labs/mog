import type { WorkbookSessionId } from './types';

export interface ExternalWorkbookSession {
  readonly workbook: {
    getSheet(name: string): Promise<{
      getValue(address: string): Promise<unknown>;
    }>;
  };
}

const REGISTRY_KEY = Symbol.for('mog.externalWorkbookSessions');

function registry(): Map<WorkbookSessionId, ExternalWorkbookSession> {
  const globalWithRegistry = globalThis as typeof globalThis & {
    [REGISTRY_KEY]?: Map<WorkbookSessionId, ExternalWorkbookSession>;
  };
  globalWithRegistry[REGISTRY_KEY] ??= new Map<WorkbookSessionId, ExternalWorkbookSession>();
  return globalWithRegistry[REGISTRY_KEY];
}

export function registerExternalWorkbookSession(
  sessionId: WorkbookSessionId,
  session: ExternalWorkbookSession,
): () => void {
  const sessions = registry();
  sessions.set(sessionId, session);
  return () => {
    if (sessions.get(sessionId) === session) {
      sessions.delete(sessionId);
    }
  };
}

export function getExternalWorkbookSession(
  sessionId: WorkbookSessionId,
): ExternalWorkbookSession | null {
  return registry().get(sessionId) ?? null;
}
