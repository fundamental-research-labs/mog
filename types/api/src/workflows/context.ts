/**
 * Workflow Context API Contracts
 *
 * Defines the WorkflowContext interface available within workflow steps.
 * All operations are durable (persisted and replayable).
 * Same API works in both local (Pyodide) and cloud (Python) runtimes.
 *
 * The Context API provides access to:
 * - App APIs (high-level domain operations): ctx.apps.*
 * - Kernel APIs (low-level data primitives): ctx.tables, ctx.records, ctx.relations
 * - External Communication: ctx.http, ctx.notify, ctx.secrets
 * - Time & Scheduling: ctx.now(), ctx.sleep()
 * - Workflow Control: ctx.spawn(), ctx.emit(), ctx.workflows
 * - Instance Info: ctx.instance_id, ctx.current_step, ctx.runtime, ctx.config
 *
 */

import type { Chart, ChartConfig } from '@mog/types-data/data/charts';
import type { RuntimeType } from './runtime';

// =============================================================================
// App Registry (High-Level Domain APIs)
// =============================================================================

/**
 * Registry of app-specific APIs.
 * Each app provides domain operations that abstract kernel primitives.
 */
export interface AppRegistry {
  /** CRM app API */
  readonly crm: CRMAppAPI;

  /** Finance app API */
  readonly finance: FinanceAppAPI;

  /** Spreadsheet app API */
  readonly spreadsheet: SpreadsheetAppAPI;

  /** Analytics app API */
  readonly analytics: AnalyticsAppAPI;

  /** Bug Tracker app API */
  readonly bugTracker: BugTrackerAppAPI;
}

// =============================================================================
// CRM App API
// =============================================================================

/**
 * CRM App API - Domain operations for sales and customer management.
 */
export interface CRMAppAPI {
  // Deals
  createDeal(params: CreateDealParams): Promise<Deal>;
  getDeal(dealId: string, options?: GetDealOptions): Promise<Deal>;
  updateDeal(dealId: string, params: UpdateDealParams): Promise<Deal>;
  moveDealToStage(dealId: string, stage: string): Promise<Deal>;
  assignDealOwner(dealId: string, ownerEmail: string): Promise<Deal>;
  getDealsInStage(stage: string): Promise<Deal[]>;
  getDealsClosingSoon(days: number): Promise<Deal[]>;
  getDealsClosedBetween(startDate: Date, endDate: Date): Promise<Deal[]>;

  // Pipeline
  getPipeline(name: string): Promise<Pipeline>;
  getPipelineMetrics(pipelineId: string): Promise<PipelineMetrics>;

  // Contacts
  createContact(params: CreateContactParams): Promise<Contact>;
  getContact(contactId: string): Promise<Contact>;
  linkContactToDeal(contactId: string, dealId: string): Promise<void>;
  enrichContact(contactId: string): Promise<Contact>;
  getContactsByCompany(companyId: string): Promise<Contact[]>;

  // Companies
  createCompany(params: CreateCompanyParams): Promise<Company>;
  getCompany(companyId: string): Promise<Company>;
}

export interface CreateDealParams {
  name: string;
  value: number;
  stage?: string;
  owner?: string;
  pipeline?: string;
  company?: string;
  expectedCloseDate?: Date;
  customFields?: Record<string, unknown>;
}

export interface UpdateDealParams {
  name?: string;
  value?: number;
  stage?: string;
  owner?: string;
  expectedCloseDate?: Date;
  customFields?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GetDealOptions {
  include?: ('company' | 'contacts' | 'owner' | 'activities')[];
}

export interface Deal {
  id: string;
  name: string;
  value: number;
  stage: string;
  owner?: DealOwner;
  company?: Company;
  contacts?: Contact[];
  expectedCloseDate?: string;
  createdAt: string;
  updatedAt: string;
  customFields?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DealOwner {
  id: string;
  name: string;
  email: string;
}

export interface Pipeline {
  id: string;
  name: string;
  stages: string[];
}

export interface PipelineMetrics {
  totalValue: number;
  dealCount: number;
  averageValue: number;
  byStage: Record<string, { count: number; value: number }>;
}

export interface Contact {
  id: string;
  name: string;
  email: string;
  phone?: string;
  company?: Company;
  customFields?: Record<string, unknown>;
}

export interface CreateContactParams {
  name: string;
  email: string;
  phone?: string;
  companyId?: string;
  customFields?: Record<string, unknown>;
}

export interface Company {
  id: string;
  name: string;
  domain?: string;
  industry?: string;
  segment?: string;
  customFields?: Record<string, unknown>;
}

export interface CreateCompanyParams {
  name: string;
  domain?: string;
  industry?: string;
  segment?: string;
  customFields?: Record<string, unknown>;
}

// =============================================================================
// Finance App API
// =============================================================================

/**
 * Finance App API - Domain operations for financial management.
 */
export interface FinanceAppAPI {
  // Invoices
  createInvoice(params: CreateInvoiceParams): Promise<Invoice>;
  getInvoice(invoiceId: string): Promise<Invoice>;
  sendInvoice(invoiceId: string): Promise<void>;
  recordPayment(invoiceId: string, amount: number, method?: string): Promise<Payment>;
  voidInvoice(invoiceId: string, reason: string): Promise<void>;

  // Accounts
  getAccount(accountId: string): Promise<Account>;
  getAccountBalance(accountId: string): Promise<number>;
  transferFunds(from: string, to: string, amount: number, memo?: string): Promise<Transfer>;

  // Transactions
  createTransaction(params: CreateTransactionParams): Promise<Transaction>;
  categorizeTransaction(transactionId: string, category: string): Promise<Transaction>;

  // Reports
  generateProfitLoss(startDate: Date, endDate: Date): Promise<FinancialReport>;
  generateBalanceSheet(asOfDate: Date): Promise<FinancialReport>;
  generateCashFlow(startDate: Date, endDate: Date): Promise<FinancialReport>;

  // Reconciliation
  importBankStatement(csv: string, accountId: string): Promise<Transaction[]>;
  reconcileTransactions(params: ReconcileParams): Promise<ReconcileResult>;
}

export interface CreateInvoiceParams {
  customerId: string;
  amount?: number;
  lineItems?: LineItem[];
  dueDate?: Date;
  dueDays?: number;
  notes?: string;
  sourceDealId?: string;
}

export interface LineItem {
  description: string;
  amount: number;
  quantity?: number;
  unitPrice?: number;
}

export interface Invoice {
  id: string;
  number: string;
  customerId: string;
  amount: number;
  lineItems: LineItem[];
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'void';
  dueDate: string;
  paidAmount: number;
  createdAt: string;
  sentAt?: string;
  paidAt?: string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  amount: number;
  method: string;
  paidAt: string;
}

export interface Account {
  id: string;
  name: string;
  type: 'checking' | 'savings' | 'credit' | 'investment';
  balance: number;
  currency: string;
}

export interface Transfer {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  memo?: string;
  transferredAt: string;
}

export interface Transaction {
  id: string;
  accountId: string;
  amount: number;
  type: 'debit' | 'credit';
  category?: string;
  description: string;
  date: string;
  reconciled: boolean;
}

export interface CreateTransactionParams {
  accountId: string;
  amount: number;
  type: 'debit' | 'credit';
  description: string;
  category?: string;
  date?: Date;
}

export interface FinancialReport {
  id: string;
  type: 'profit_loss' | 'balance_sheet' | 'cash_flow';
  startDate: string;
  endDate: string;
  data: Record<string, unknown>;
  generatedAt: string;
}

export interface ReconcileParams {
  accountId: string;
  statementEndDate: Date;
  statementBalance: number;
}

export interface ReconcileResult {
  matched: number;
  unmatched: number;
  difference: number;
  reconciled: boolean;
}

// =============================================================================
// Spreadsheet App API
// =============================================================================

/**
 * Spreadsheet App API - Domain operations for spreadsheet manipulation.
 */
export interface SpreadsheetAppAPI {
  // Cell operations
  getCell(sheet: string, cell: string): Promise<WorkflowCellValue>;
  setCell(sheet: string, cell: string, value: WorkflowCellValue): Promise<void>;
  getRange(sheet: string, range: string): Promise<WorkflowCellValue[][]>;
  setRange(sheet: string, range: string, values: WorkflowCellValue[][]): Promise<void>;
  clearRange(sheet: string, range: string): Promise<void>;

  // Row operations
  appendRow(sheet: string, values: WorkflowCellValue[]): Promise<number>;
  insertRows(sheet: string, afterRow: number, count: number): Promise<void>;
  deleteRows(sheet: string, startRow: number, count: number): Promise<void>;

  // Formulas
  setFormula(sheet: string, cell: string, formula: string): Promise<void>;
  evaluateFormula(formula: string, context?: { sheet?: string }): Promise<WorkflowCellValue>;

  // Sheets
  createSheet(name: string): Promise<Sheet>;
  getSheet(name: string): Promise<Sheet>;
  duplicateSheet(sheetName: string, newName: string): Promise<Sheet>;
  deleteSheet(sheetName: string): Promise<void>;

  // Charts
  createChart(sheet: string, config: ChartConfig): Promise<Chart>;
  updateChart(chartId: string, config: Partial<ChartConfig>): Promise<Chart>;

  // Data operations
  applyFilter(sheet: string, range: string, filter: FilterConfig): Promise<void>;
  clearFilter(sheet: string): Promise<void>;
  sortRange(sheet: string, range: string, sortBy: SortConfig[]): Promise<void>;
  createPivotTable(source: string, config: PivotConfig): Promise<PivotTable>;

  // Import/Export
  importCSV(sheet: string, csv: string, options?: ImportOptions): Promise<void>;
  exportToCSV(sheet: string, range?: string): Promise<string>;
  exportToPDF(sheets?: string[]): Promise<Blob>;
}

/**
 * Cell value type for workflow context.
 *
 * Intentionally different from the canonical `CellValue` in `@mog-sdk/contracts/core`
 * which is `string | number | boolean | null | CellError`. This workflow variant includes `Date`
 * for date-aware operations and excludes `CellError`.
 *
 * @see `@mog-sdk/contracts/core` for the canonical `CellValue` type.
 */
export type WorkflowCellValue = string | number | boolean | null | Date;

export interface Sheet {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
}

// Chart types re-exported from canonical definitions
export type { AxisConfig, Chart, ChartConfig } from '@mog/types-data/data/charts';

export interface FilterConfig {
  column: number;
  criteria: FilterCriteria;
}

export interface FilterCriteria {
  type: 'equals' | 'contains' | 'greater_than' | 'less_than' | 'between' | 'in_list';
  value: unknown;
  value2?: unknown; // For 'between'
}

export interface SortConfig {
  column: number;
  direction: 'asc' | 'desc';
}

export interface PivotConfig {
  rows: string[];
  columns?: string[];
  values: PivotValueConfig[];
  filters?: Record<string, unknown>;
}

export interface PivotValueConfig {
  field: string;
  aggregation: 'sum' | 'count' | 'average' | 'min' | 'max';
}

export interface PivotTable {
  id: string;
  sourceRange: string;
  config: PivotConfig;
}

export interface ImportOptions {
  delimiter?: string;
  hasHeader?: boolean;
  startCell?: string;
}

// =============================================================================
// Analytics App API
// =============================================================================

/**
 * Analytics App API - Domain operations for metrics and analytics.
 */
export interface AnalyticsAppAPI {
  // Events
  trackEvent(name: string, properties?: Record<string, unknown>): Promise<void>;
  getEvents(query: EventQuery): Promise<AnalyticsEvent[]>;

  // Metrics
  getMetric(name: string, timeRange: TimeRange): Promise<MetricValue>;
  incrementMetric(name: string, value: number, dimensions?: Record<string, string>): Promise<void>;

  // Dashboards
  getDashboard(dashboardId: string): Promise<Dashboard>;
  refreshDashboard(dashboardId: string): Promise<void>;

  // Funnels
  getFunnelConversion(funnelId: string, timeRange: TimeRange): Promise<FunnelResult>;

  // Cohorts
  getCohortRetention(cohortId: string, timeRange: TimeRange): Promise<RetentionResult>;
}

export interface EventQuery {
  eventName?: string;
  startDate: Date;
  endDate: Date;
  filters?: Record<string, unknown>;
  limit?: number;
}

export interface AnalyticsEvent {
  id: string;
  name: string;
  properties: Record<string, unknown>;
  timestamp: string;
  userId?: string;
}

export interface TimeRange {
  start: Date;
  end: Date;
  granularity?: 'hour' | 'day' | 'week' | 'month';
}

export interface MetricValue {
  name: string;
  value: number;
  previousValue?: number;
  change?: number;
  changePercent?: number;
  timeSeries?: Array<{ timestamp: string; value: number }>;
}

export interface Dashboard {
  id: string;
  name: string;
  widgets: DashboardWidget[];
  lastRefreshed: string;
}

export interface DashboardWidget {
  id: string;
  type: 'metric' | 'chart' | 'table';
  config: Record<string, unknown>;
}

export interface FunnelResult {
  steps: FunnelStep[];
  overallConversion: number;
}

export interface FunnelStep {
  name: string;
  count: number;
  conversionRate: number;
  dropoff: number;
}

export interface RetentionResult {
  cohortSize: number;
  periods: RetentionPeriod[];
}

export interface RetentionPeriod {
  period: number;
  retained: number;
  retentionRate: number;
}

// =============================================================================
// Bug Tracker App API
// =============================================================================

/**
 * Bug Tracker App API - Domain operations for issue tracking.
 */
export interface BugTrackerAppAPI {
  // Issues
  createIssue(params: CreateIssueParams): Promise<Issue>;
  getIssue(issueId: string): Promise<Issue>;
  updateIssue(issueId: string, params: UpdateIssueParams): Promise<Issue>;
  closeIssue(issueId: string, resolution?: string): Promise<Issue>;
  assignIssue(issueId: string, assigneeEmail: string): Promise<Issue>;

  // Projects
  createProject(params: CreateProjectParams): Promise<Project>;
  getProject(projectId: string): Promise<Project>;
  getProjectTasks(projectId: string): Promise<Issue[]>;

  // Labels & Milestones
  addLabel(issueId: string, label: string): Promise<void>;
  removeLabel(issueId: string, label: string): Promise<void>;
  setMilestone(issueId: string, milestoneId: string): Promise<void>;
}

export interface CreateIssueParams {
  title: string;
  description?: string;
  project?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  type?: 'bug' | 'feature' | 'task' | 'improvement';
  assignee?: string;
  labels?: string[];
}

export interface UpdateIssueParams {
  title?: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  status?: string;
  assignee?: string;
  labels?: string[];
}

export interface Issue {
  id: string;
  title: string;
  description?: string;
  status: 'open' | 'in_progress' | 'review' | 'done' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'critical';
  type: 'bug' | 'feature' | 'task' | 'improvement';
  assignee?: { id: string; name: string; email: string };
  labels: string[];
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export interface CreateProjectParams {
  name: string;
  description?: string;
  template?: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  issueCount: number;
  createdAt: string;
}

// =============================================================================
// Kernel APIs (Low-Level Data Primitives)
// =============================================================================

/**
 * Tables API - Table operations.
 */
export interface TablesAPI {
  /** Find a table by name */
  findByName(name: string): Promise<TableInfo | null>;

  /** List all tables */
  list(): Promise<TableInfo[]>;

  /** Get table by ID */
  get(tableId: string): Promise<TableInfo | null>;
}

export interface TableInfo {
  id: string;
  name: string;
  columnCount: number;
  rowCount: number;
}

/**
 * Records API - Record CRUD operations.
 */
export interface RecordsAPI {
  /** Get a single record */
  get(tableName: string, recordId: string): Promise<Record<string, unknown> | null>;

  /** List records with optional filtering */
  list(
    tableName: string,
    options?: {
      filter?: RecordFilter;
      sort?: RecordSort[];
      limit?: number;
      offset?: number;
    },
  ): Promise<Record<string, unknown>[]>;

  /** Create a new record */
  create(tableName: string, values: Record<string, unknown>): Promise<Record<string, unknown>>;

  /** Update a record */
  update(
    tableName: string,
    recordId: string,
    values: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;

  /** Delete a record */
  delete(tableName: string, recordId: string): Promise<void>;
}

export interface RecordFilter {
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than' | 'in';
  value: unknown;
}

export interface RecordSort {
  field: string;
  direction: 'asc' | 'desc';
}

/**
 * Relations API - Relation traversal.
 */
export interface RelationsAPI {
  /** Get related records through a relation column */
  getRelated(
    tableName: string,
    recordId: string,
    relationColumn: string,
  ): Promise<Record<string, unknown>[]>;

  /** Get records that link TO this record (reverse lookup) */
  getBacklinks(tableName: string, recordId: string): Promise<Record<string, unknown>[]>;
}

// =============================================================================
// HTTP Client
// =============================================================================

/**
 * HTTP client for external API calls.
 * Automatically adds idempotency keys: {instance_id}-{step_name}-{attempt}
 */
export interface HttpClient {
  /** GET request */
  get(url: string, options?: HttpRequestOptions): Promise<HttpResponse>;

  /** POST request */
  post(url: string, options?: HttpRequestOptions): Promise<HttpResponse>;

  /** PUT request */
  put(url: string, options?: HttpRequestOptions): Promise<HttpResponse>;

  /** PATCH request */
  patch(url: string, options?: HttpRequestOptions): Promise<HttpResponse>;

  /** DELETE request */
  delete(url: string, options?: HttpRequestOptions): Promise<HttpResponse>;
}

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  json?: unknown;
  body?: string | ArrayBuffer;
  query?: Record<string, string>;
  timeout?: number;
}

export interface HttpResponse {
  /** HTTP status code */
  status: number;

  /** Whether response is successful (2xx) */
  ok: boolean;

  /** Response headers */
  headers: Record<string, string>;

  /** Get response as JSON */
  json(): unknown;

  /** Get response as text */
  text(): string;

  /** Get response as bytes */
  bytes(): ArrayBuffer;
}

// =============================================================================
// Notification Service
// =============================================================================

/**
 * Notification service for email, Slack, and in-app notifications.
 */
export interface NotificationService {
  /** Send email */
  email(options: EmailOptions): Promise<void>;

  /** Send Slack message */
  slack(options: SlackOptions): Promise<void>;

  /** Show in-app toast notification */
  toast(options: ToastOptions): Promise<void>;
}

export interface EmailOptions {
  to: string | string[];
  subject: string;
  body?: string;
  template?: string;
  data?: Record<string, unknown>;
  cc?: string | string[];
  bcc?: string | string[];
  /** Action buttons that emit events when clicked */
  actions?: EmailAction[];
}

export interface EmailAction {
  label: string;
  event: string;
  data?: Record<string, unknown>;
}

export interface SlackOptions {
  channel: string;
  message: string;
  blocks?: SlackBlock[];
  threadTs?: string;
}

export interface SlackBlock {
  type: 'section' | 'divider' | 'actions' | 'context';
  text?: { type: 'mrkdwn' | 'plain_text'; text: string };
  elements?: unknown[];
}

export interface ToastOptions {
  user?: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
  action?: {
    label: string;
    url?: string;
  };
}

// =============================================================================
// Secrets Manager
// =============================================================================

/**
 * Secrets manager for secure credential access.
 * Values are never logged or persisted in workflow state.
 */
export interface SecretsManager {
  /** Get a secret by name */
  get(name: string): string | null;

  /** Check if a secret exists */
  has(name: string): boolean;
}

// =============================================================================
// Workflows API
// =============================================================================

/**
 * API for querying and controlling other workflows.
 */
export interface WorkflowsAPI {
  /** Find workflow instances */
  find(options: FindWorkflowsOptions): Promise<WorkflowInstanceInfo[]>;

  /** Signal another workflow instance */
  signal(instanceId: string, eventType: string, data?: Record<string, unknown>): Promise<void>;

  /** Cancel a workflow instance */
  cancel(instanceId: string, reason?: string): Promise<void>;

  /** Get workflow instance details */
  getInstance(instanceId: string): Promise<WorkflowInstanceInfo | null>;
}

export interface FindWorkflowsOptions {
  workflowClass?: string;
  filter?: Record<string, unknown>;
  status?: ('running' | 'waiting' | 'sleeping' | 'completed' | 'failed')[];
  limit?: number;
}

export interface WorkflowInstanceInfo {
  id: string;
  workflowId: string;
  status: string;
  currentStep: string | null;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Workflow Configuration
// =============================================================================

/**
 * Workflow configuration and environment.
 */
export interface WorkflowConfig {
  /** Company/organization name */
  companyName?: string;

  /** Current environment */
  environment: 'production' | 'staging' | 'development';

  /** Base URL for API calls */
  baseUrl?: string;

  /** Custom configuration values */
  [key: string]: unknown;
}

// =============================================================================
// Main Context Interface
// =============================================================================

/**
 * WorkflowContext - The context available within workflow steps.
 * All operations are durable - persisted and replayable.
 * Same API works in both local and cloud runtimes.
 */
export interface WorkflowContext {
  // =========================================================================
  // App APIs (High-Level, Domain-Specific)
  // =========================================================================

  /**
   * Access app-specific APIs. Each app provides domain operations.
   *
   * @example
   * ctx.apps.crm.create_deal(name="Acme", value=50000)
   * ctx.apps.finance.create_invoice(customer_id=..., amount=...)
   * ctx.apps.spreadsheet.append_row("Log", [date, value])
   */
  readonly apps: AppRegistry;

  // =========================================================================
  // Kernel APIs (Low-Level, Data Primitives)
  // =========================================================================

  /**
   * Table operations.
   *
   * @example
   * table = ctx.tables.find_by_name("Expenses")
   */
  readonly tables: TablesAPI;

  /**
   * Record CRUD operations.
   *
   * @example
   * expense = ctx.records.get("expenses", record_id)
   * ctx.records.update("expenses", record_id, {"status": "approved"})
   */
  readonly records: RecordsAPI;

  /**
   * Relation traversal.
   *
   * @example
   * related = ctx.relations.get_related("deals", deal_id, "contact_id")
   */
  readonly relations: RelationsAPI;

  // =========================================================================
  // External Communication
  // =========================================================================

  /**
   * Make HTTP requests to external APIs.
   * Automatically adds idempotency keys.
   *
   * @example
   * response = ctx.http.post("https://api.stripe.com/...", json={...})
   */
  readonly http: HttpClient;

  /**
   * Send notifications (email, Slack, in-app).
   *
   * @example
   * ctx.notify.email(to="manager@co.com", subject="Approval needed")
   * ctx.notify.slack(channel="#sales", message="Deal closed!")
   * ctx.notify.toast(user=user_id, message="Request approved")
   */
  readonly notify: NotificationService;

  /**
   * Access secrets (API keys, tokens). Never logged.
   *
   * @example
   * api_key = ctx.secrets.get("OPENAI_API_KEY")
   */
  readonly secrets: SecretsManager;

  // =========================================================================
  // Time & Scheduling
  // =========================================================================

  /**
   * Get current time (consistent within workflow execution).
   */
  now(): Date;

  /**
   * Pause workflow for duration. TRIGGERS AUTO-PROMOTION TO CLOUD.
   *
   * @param duration - Duration in milliseconds or object with time units
   *
   * @example
   * ctx.sleep({ hours: 24 })
   * ctx.sleep({ days: 7 })
   * ctx.sleep(3600000) // 1 hour in ms
   */
  sleep(duration: number | SleepDuration): Promise<void>;

  // =========================================================================
  // Workflow Control
  // =========================================================================

  /**
   * Start a child workflow. Returns instance ID.
   *
   * @example
   * child_id = ctx.spawn(CustomerOnboarding, {"deal_id": deal_id})
   */
  spawn(workflowClass: string, input: Record<string, unknown>): Promise<string>;

  /**
   * Emit event (triggers other workflows or signals waiting ones).
   *
   * @example
   * ctx.emit("onboarding:completed", {"deal_id": deal_id})
   */
  emit(eventType: string, data: Record<string, unknown>): Promise<void>;

  /**
   * Query and signal other workflows.
   */
  readonly workflows: WorkflowsAPI;

  /**
   * Explicitly promote to cloud runtime.
   * Call this when you know you'll need cloud capabilities.
   */
  promoteToCloud(): Promise<void>;

  // =========================================================================
  // Instance Info (Read-Only)
  // =========================================================================

  /** Current workflow instance ID */
  readonly instanceId: string;

  /** Current step name */
  readonly currentStep: string;

  /** Current runtime: 'local' or 'cloud' */
  readonly runtime: RuntimeType;

  /** Workflow configuration / environment */
  readonly config: WorkflowConfig;
}

/**
 * Sleep duration specification.
 */
export interface SleepDuration {
  milliseconds?: number;
  seconds?: number;
  minutes?: number;
  hours?: number;
  days?: number;
  weeks?: number;
}
