/**
 * Workflow Contracts - Public Exports
 *
 * This module exports all types and utilities for the workflow system.
 * These contracts define the interface between:
 * - TypeScript (browser) and Python (cloud) runtimes
 * - Local (Pyodide) and Cloud (server) execution
 * - Workflow definitions and runtime implementations
 *
 */

// =============================================================================
// Definition Types (Workflow, Step, Decorators)
// =============================================================================

export type {
  BackoffStrategy,
  NonRetryableError,
  ParallelConfig,
  ParallelDecoratorOptions,
  RetryConfig,
  RetryDecoratorOptions,
  RetryableError,
  StepDecoratorOptions,
  StepDefinition,
  // Wait/Retry/Parallel configs
  WaitForConfig,
  WaitForDecoratorOptions,
  // Decorator options (TypeScript representation of Python decorators)
  WorkflowDecoratorOptions,
  // Core definitions
  WorkflowDefinition,
  // Error types
  WorkflowError,
  WorkflowMetadata,
} from './definition';

// =============================================================================
// Instance Types (State, History, Runtime)
// =============================================================================

export type {
  CellTriggerPayload as InstanceCellTriggerPayload,
  // Instance error
  InstanceError,
  InstanceErrorType,
  ManualTriggerPayload as InstanceManualTriggerPayload,
  // Query types
  InstanceQueryOptions,
  InstanceQueryResult,
  RecordTriggerPayload as InstanceRecordTriggerPayload,
  ScheduleTriggerPayload as InstanceScheduleTriggerPayload,
  InstanceSortOption,
  SpawnedTriggerPayload as InstanceSpawnedTriggerPayload,
  InstanceStatus,
  InstanceSummary,
  WebhookTriggerPayload as InstanceWebhookTriggerPayload,
  JsonSerializable,
  RetryAttempt,
  // Retry state
  RetryState,
  StepError,
  // Step history
  StepHistory,
  StepStatus,
  // Timer types
  Timer,
  TimerType,
  // Trigger event data
  TriggerEventData,
  // Core instance types
  WorkflowInstance,
  WorkflowState,
} from './instance';

// =============================================================================
// Context API Types
// =============================================================================

export type {
  Account,
  // Analytics API
  AnalyticsAppAPI,
  AnalyticsEvent,
  // App registry
  AppRegistry,
  AxisConfig,
  // Bug Tracker API
  BugTrackerAppAPI,
  // CRM API
  CRMAppAPI,
  Chart,
  ChartConfig,
  Company,
  Contact,
  CreateCompanyParams,
  CreateContactParams,
  CreateDealParams,
  CreateInvoiceParams,
  CreateIssueParams,
  CreateProjectParams,
  CreateTransactionParams,
  Dashboard,
  DashboardWidget,
  Deal,
  DealOwner,
  EmailAction,
  EmailOptions,
  EventQuery,
  FilterConfig,
  FilterCriteria,
  // Finance API
  FinanceAppAPI,
  FinancialReport,
  FindWorkflowsOptions,
  FunnelResult,
  FunnelStep,
  GetDealOptions,
  // HTTP Client
  HttpClient,
  HttpRequestOptions,
  HttpResponse,
  ImportOptions,
  Invoice,
  Issue,
  LineItem,
  MetricValue,
  // Notification Service
  NotificationService,
  Payment,
  Pipeline,
  PipelineMetrics,
  PivotConfig,
  PivotTable,
  PivotValueConfig,
  Project,
  ReconcileParams,
  ReconcileResult,
  RecordFilter,
  RecordSort,
  RecordsAPI,
  RelationsAPI,
  RetentionPeriod,
  RetentionResult,
  // Secrets Manager
  SecretsManager,
  Sheet,
  SlackBlock,
  SlackOptions,
  SleepDuration,
  SortConfig,
  // Spreadsheet API
  SpreadsheetAppAPI,
  TableInfo,
  // Kernel APIs
  TablesAPI,
  TimeRange,
  ToastOptions,
  Transaction,
  Transfer,
  UpdateDealParams,
  UpdateIssueParams,
  WorkflowCellValue,
  WorkflowConfig,
  // Main context interface
  WorkflowContext,
  WorkflowInstanceInfo,
  // Workflows API
  WorkflowsAPI,
} from './context';

// =============================================================================
// Trigger Types
// =============================================================================

export type {
  CellFilterCondition,
  // Cell triggers
  CellTrigger,
  CellTriggerPayload,
  FilterOperator,
  // Manual triggers
  ManualTrigger,
  ManualTriggerPayload,
  RecordCreatedTrigger,
  RecordDeletedTrigger,
  RecordFilterCondition,
  // Record triggers
  RecordTrigger,
  RecordTriggerBase,
  RecordTriggerPayload,
  RecordUpdatedTrigger,
  // Registration
  RegisteredTrigger,
  RelationLinkedTrigger,
  // Relation triggers
  RelationTrigger,
  RelationTriggerPayload,
  RelationUnlinkedTrigger,
  // Schedule triggers
  ScheduleTrigger,
  ScheduleTriggerPayload,
  // Spawned triggers
  SpawnedTrigger,
  SpawnedTriggerPayload,
  // Trigger config union
  TriggerConfig,
  // Runtime trigger types
  TriggerEvent,
  TriggerMatch,
  TriggerPayload,
  // Trigger type enum
  TriggerType,
  WebhookAuth,
  WebhookAuthApiKey,
  WebhookAuthBearer,
  WebhookAuthHmac,
  WebhookAuthNone,
  WebhookMethod,
  // Webhook triggers
  WebhookTrigger,
  WebhookTriggerPayload,
} from './triggers';

// =============================================================================
// Event Types
// =============================================================================

export type {
  DeadLetterReason,
  ErrorCategory,
  // Event bus interface
  IWorkflowEventBus,
  PromotionReason,
  StepCompletedEvent,
  StepFailedEvent,
  // System events
  StepRetryEvent,
  StepSkippedEvent,
  // Step lifecycle events
  StepStartedEvent,
  WakeReason,
  WorkflowCancelledEvent,
  WorkflowCompletedEvent,
  WorkflowDeadLetterEvent,
  WorkflowErrorEvent,
  // Union type
  WorkflowEvent,
  // Base event
  WorkflowEventBase,
  WorkflowEventFilter,
  // Handler types
  WorkflowEventHandler,
  WorkflowEventSubscription,
  WorkflowEventType,
  WorkflowFailedEvent,
  WorkflowPausedEvent,
  // Runtime events
  WorkflowPromotedEvent,
  WorkflowResumedEvent,
  WorkflowSignal,
  WorkflowSleepingEvent,
  // Instance lifecycle events
  WorkflowStartedEvent,
  WorkflowWaitingEvent,
  WorkflowWokenEvent,
} from './events';

// =============================================================================
// Runtime Types
// =============================================================================

export type {
  AutoPromotionTrigger,
  // Runtime interface
  IWorkflowRuntime,
  PromotionError,
  PromotionErrorType,
  // Promotion state
  PromotionState,
  PromotionStatus,
  PyodideConfig,
  // Pyodide-specific
  PyodideState,
  // Capabilities
  RuntimeCapabilities,
  RuntimeConfig,
  // Core runtime types
  RuntimeType,
  // Serialization
  SerializedInstance,
  SerializedMetadata,
  SerializedStepHistory,
  SerializedTimer,
  StateValidationError,
  StateValidationResult,
  StepExecutionResult,
} from './runtime';

// =============================================================================
// Versioning Types
// =============================================================================

export type {
  // Registry interface
  IVersionRegistry,
  MigrationConfig,
  MigrationContext,
  MigrationFailure,
  MigrationFunction,
  // Migration operation
  MigrationOperation,
  MigrationStatus,
  // Semantic version
  SemanticVersion,
  // State migration
  StateMigrationResult,
  VersionMetadata,
  VersioningConfig,
  // Strategy types
  VersioningStrategy,
  // Version info
  WorkflowVersion,
} from './versioning';
