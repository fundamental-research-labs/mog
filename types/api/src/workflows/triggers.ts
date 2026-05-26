/**
 * Workflow Trigger Contracts
 *
 * Type definitions for workflow triggers - the conditions that start workflows.
 *
 * Trigger Types:
 * - Record triggers: record:created, record:updated, record:deleted
 * - Cell triggers: cell:changed
 * - Relation triggers: relation:linked, relation:unlinked
 * - Schedule triggers: cron-based schedules (cloud-only)
 * - Webhook triggers: external HTTP requests (cloud-only)
 * - Manual triggers: user-initiated
 * - Spawned triggers: started by another workflow
 *
 */

// =============================================================================
// Trigger Types
// =============================================================================

/**
 * All supported trigger types.
 */
export type TriggerType =
  | 'record:created'
  | 'record:updated'
  | 'record:deleted'
  | 'cell:changed'
  | 'relation:linked'
  | 'relation:unlinked'
  | 'schedule'
  | 'webhook'
  | 'manual'
  | 'workflow:spawned';

// =============================================================================
// Trigger Configurations (Union Type)
// =============================================================================

/**
 * Union of all trigger configurations.
 */
export type TriggerConfig =
  | RecordTrigger
  | CellTrigger
  | RelationTrigger
  | ScheduleTrigger
  | WebhookTrigger
  | ManualTrigger
  | SpawnedTrigger;

// =============================================================================
// Record Triggers
// =============================================================================

/**
 * Base configuration for record triggers.
 */
export interface RecordTriggerBase {
  /** Table name to watch */
  table: string;

  /** Optional filter condition (only trigger if record matches) */
  filter?: RecordFilterCondition;
}

/**
 * Trigger when a record is created.
 */
export interface RecordCreatedTrigger extends RecordTriggerBase {
  type: 'record:created';
}

/**
 * Trigger when a record is updated.
 */
export interface RecordUpdatedTrigger extends RecordTriggerBase {
  type: 'record:updated';

  /** Specific field to watch (any field if not specified) */
  field?: string;

  /** Specific value to match (any value if not specified) */
  value?: unknown;

  /** Only trigger if field changed FROM this value */
  oldValue?: unknown;
}

/**
 * Trigger when a record is deleted.
 */
export interface RecordDeletedTrigger extends RecordTriggerBase {
  type: 'record:deleted';
}

/**
 * Union of all record triggers.
 */
export type RecordTrigger = RecordCreatedTrigger | RecordUpdatedTrigger | RecordDeletedTrigger;

/**
 * Filter condition for record triggers.
 */
export interface RecordFilterCondition {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

/**
 * Filter operators for record triggers.
 */
export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'greater_than_or_equals'
  | 'less_than'
  | 'less_than_or_equals'
  | 'in'
  | 'not_in'
  | 'is_null'
  | 'is_not_null';

// =============================================================================
// Cell Triggers
// =============================================================================

/**
 * Trigger when a cell value changes.
 */
export interface CellTrigger {
  type: 'cell:changed';

  /** Sheet name to watch */
  sheet: string;

  /** Range to watch (e.g., "B2:B100", "A1", "Column:B") */
  range: string;

  /** Optional filter on value */
  filter?: CellFilterCondition;
}

/**
 * Filter condition for cell triggers.
 */
export interface CellFilterCondition {
  /** Only trigger if new value matches */
  newValue?: unknown;

  /** Only trigger if old value matches */
  oldValue?: unknown;

  /** Only trigger if value changed (true = must change, false = any update) */
  changed?: boolean;
}

// =============================================================================
// Relation Triggers
// =============================================================================

/**
 * Trigger when a relation is linked.
 */
export interface RelationLinkedTrigger {
  type: 'relation:linked';

  /** Table containing the relation column */
  table: string;

  /** Relation column name */
  column: string;

  /** Optional: target table (only trigger if linked to specific table) */
  targetTable?: string;
}

/**
 * Trigger when a relation is unlinked.
 */
export interface RelationUnlinkedTrigger {
  type: 'relation:unlinked';

  /** Table containing the relation column */
  table: string;

  /** Relation column name */
  column: string;

  /** Optional: target table */
  targetTable?: string;
}

/**
 * Union of relation triggers.
 */
export type RelationTrigger = RelationLinkedTrigger | RelationUnlinkedTrigger;

// =============================================================================
// Schedule Triggers (Cloud-Only)
// =============================================================================

/**
 * Trigger on a schedule (cron expression).
 * Always runs on cloud runtime.
 */
export interface ScheduleTrigger {
  type: 'schedule';

  /** Cron expression (e.g., "0 9 * * 1" for Monday 9am) */
  cron: string;

  /** Timezone (e.g., "America/New_York", "UTC") */
  timezone: string;

  /**
   * Whether to catch up on missed schedules.
   * If true, runs immediately for any missed scheduled times.
   * Default: false
   */
  catchUp?: boolean;

  /**
   * Maximum concurrent instances from this schedule.
   * If an instance is still running when the next schedule fires,
   * new instance is skipped if maxConcurrent is reached.
   * Default: 1
   */
  maxConcurrent?: number;
}

// =============================================================================
// Webhook Triggers (Cloud-Only)
// =============================================================================

/**
 * Trigger from an external HTTP request.
 * Always runs on cloud runtime.
 */
export interface WebhookTrigger {
  type: 'webhook';

  /** URL path (e.g., "/stripe-payment") */
  path: string;

  /** HTTP method (default: POST) */
  method: WebhookMethod;

  /** Optional authentication configuration */
  auth?: WebhookAuth;

  /** Validation schema for request body (JSON Schema) */
  bodySchema?: Record<string, unknown>;

  /** Transform function name to apply to request body */
  transform?: string;
}

/**
 * Supported HTTP methods for webhooks.
 */
export type WebhookMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Webhook authentication configuration.
 */
export type WebhookAuth = WebhookAuthNone | WebhookAuthBearer | WebhookAuthApiKey | WebhookAuthHmac;

export interface WebhookAuthNone {
  type: 'none';
}

export interface WebhookAuthBearer {
  type: 'bearer';
  /** Secret name containing the expected token */
  secretName: string;
}

export interface WebhookAuthApiKey {
  type: 'api_key';
  /** Header name to check */
  headerName: string;
  /** Secret name containing the expected key */
  secretName: string;
}

export interface WebhookAuthHmac {
  type: 'hmac';
  /** Header name containing the signature */
  signatureHeader: string;
  /** Secret name containing the signing key */
  secretName: string;
  /** HMAC algorithm (default: sha256) */
  algorithm?: 'sha256' | 'sha512';
}

// =============================================================================
// Manual Triggers
// =============================================================================

/**
 * Trigger manually by user or API call.
 */
export interface ManualTrigger {
  type: 'manual';

  /**
   * Input schema (JSON Schema) for manual trigger.
   * Used for UI form generation and validation.
   */
  inputSchema?: Record<string, unknown>;

  /**
   * Required permissions to trigger this workflow.
   */
  requiredPermissions?: string[];
}

// =============================================================================
// Spawned Triggers
// =============================================================================

/**
 * Trigger when spawned by another workflow.
 */
export interface SpawnedTrigger {
  type: 'workflow:spawned';

  /**
   * Input schema (JSON Schema) expected from parent.
   */
  inputSchema?: Record<string, unknown>;
}

// =============================================================================
// Trigger Event (Runtime)
// =============================================================================

/**
 * Event data passed to workflow when triggered.
 */
export interface TriggerEvent {
  /** Trigger type */
  type: TriggerType;

  /** Unique event ID */
  eventId: string;

  /** Timestamp when trigger fired (ISO 8601) */
  timestamp: string;

  /** Trigger-specific payload */
  payload: TriggerPayload;
}

/**
 * Union of all trigger payloads.
 */
export type TriggerPayload =
  | RecordTriggerPayload
  | CellTriggerPayload
  | RelationTriggerPayload
  | ScheduleTriggerPayload
  | WebhookTriggerPayload
  | ManualTriggerPayload
  | SpawnedTriggerPayload;

/**
 * Payload for record triggers.
 */
export interface RecordTriggerPayload {
  table: string;
  recordId: string;
  record?: Record<string, unknown>;
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * Payload for cell triggers.
 */
export interface CellTriggerPayload {
  sheet: string;
  cell: string;
  range: string;
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * Payload for relation triggers.
 */
export interface RelationTriggerPayload {
  table: string;
  column: string;
  sourceRecordId: string;
  targetRecordId: string;
  targetTable: string;
}

/**
 * Payload for schedule triggers.
 */
export interface ScheduleTriggerPayload {
  scheduledTime: string;
  cron: string;
  timezone: string;
}

/**
 * Payload for webhook triggers.
 */
export interface WebhookTriggerPayload {
  path: string;
  method: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  remoteAddress?: string;
}

/**
 * Payload for manual triggers.
 */
export interface ManualTriggerPayload {
  input: Record<string, unknown>;
  triggeredBy?: string;
}

/**
 * Payload for spawned triggers.
 */
export interface SpawnedTriggerPayload {
  parentWorkflowId: string;
  parentInstanceId: string;
  input: Record<string, unknown>;
}

// =============================================================================
// Trigger Registration
// =============================================================================

/**
 * Registered trigger with metadata.
 */
export interface RegisteredTrigger {
  /** Trigger ID */
  id: string;

  /** Workflow ID this trigger starts */
  workflowId: string;

  /** Workflow version */
  workflowVersion: string;

  /** Trigger configuration */
  config: TriggerConfig;

  /** Whether trigger is active */
  active: boolean;

  /** Creation timestamp */
  createdAt: string;

  /** Last updated timestamp */
  updatedAt: string;
}

/**
 * Trigger match result.
 */
export interface TriggerMatch {
  /** Matched trigger */
  trigger: RegisteredTrigger;

  /** Event that matched */
  event: TriggerEvent;

  /** Score (for prioritization when multiple triggers match) */
  score: number;
}
