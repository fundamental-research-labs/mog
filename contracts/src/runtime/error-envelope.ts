export type RuntimeErrorCategory =
  | 'auth'
  | 'permission'
  | 'not-found'
  | 'conflict'
  | 'validation'
  | 'quota'
  | 'unsupported'
  | 'runtime'
  | 'internal';

export interface RuntimeErrorEnvelope {
  code: string;
  message: string;
  status?: number;
  requestId?: string;
  traceId?: string;
  retryable: boolean;
  category: RuntimeErrorCategory;
  details?: Record<string, unknown>;
}
