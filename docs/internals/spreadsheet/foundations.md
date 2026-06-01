# Core Foundations

## Overview

These foundations are the current public contracts plus the workspace-internal
runtime/storage pieces behind spreadsheet metadata, validation, testing, links,
and eventing. Rust/Yrs backs sheet storage where noted; several surfaces here
are public contract types without a public runtime package.

```
┌─────────────────────────────────────────────────────────────────────┐
│                     CONSUMER FEATURES                                │
│  Validation UI │ Reactive UI │ API Generation │ Live Data │ Links   │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        FOUNDATIONS                                   │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐                         │
│  │  Metadata │ │  EventBus │ │   Types   │                         │
│  └───────────┘ └───────────┘ └───────────┘                         │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐                         │
│  │ Workflows │ │  Testing  │ │Connections│                         │
│  └───────────┘ └───────────┘ └───────────┘                         │
└─────────────────────────────────────────────────────────────────────┘
```

## 1. Cell Metadata

**Purpose:** Per-cell non-compute state beyond value/formula storage.

**Storage:** Embedded in the per-sheet `cellProperties` Y.Map keyed by stable
`CellId` hex strings. The per-sheet `properties` Y.Map is sheet
metadata/settings, not per-cell metadata.

> **Note:** Cell metadata is stored as fields on the unified
> `CellProperties` structure, not as a separate `CellMetadata` Yrs map. Current
> Rust storage uses `KEY_CELL_PROPERTIES = "cellProperties"`; the
> TypeScript `sheet-maps-schema.ts` `properties` entry is historical and should
> not be treated as the current per-cell storage key.

**Key files:**

- `types/core/src/core.ts` - source for `CellMetadata` and `CellProperties`
- `contracts/src/core/core.ts` - public re-export and helper exports
- `compute/core/crates/compute-document/src/schema.rs` - canonical Yrs key constants
- `compute/core/src/storage/properties.rs` and
  `compute/core/src/storage/properties/cell.rs` - Rust/Yrs cell property storage helpers
- `domain-types/src/yrs_schema/cell_properties.rs` - structured Yrs field layout

```typescript
// Public TypeScript contract shape.
interface CellDataSource {
  type: 'manual' | 'import' | 'api' | 'formula' | 'remote-link';
  source?: string;
}

interface CellMetadata {
  // === Provenance ===
  modifiedBy?: string;
  modifiedAt?: number;
  dataSource?: CellDataSource;

  // === Validation ===
  validationErrors?: ValidationError[];

  // === Live Data ===
  connectionId?: string;
  staleness?: 'fresh' | 'stale' | 'error';
  lastFetched?: number;

  // === Formula Auditing ===
  /** Whether this cell contains an array formula (CSE - Ctrl+Shift+Enter) */
  isArrayFormula?: boolean;

  // === Extensible ===
  extensions?: Record<string, unknown>;
}
```

**Enables:** Formatting, provenance tracking, validation UI, live data
indicators, formula auditing, and XLSX fidelity metadata in one sparse cell
attribute bag.

---

## 2. Event Bus

**Purpose:** Pub/sub for semantic events, decouples producers from consumers.

**Key files:**

- `kernel/src/context/event-bus.ts` - Implementation
- `types/events/src/` - Source event type definitions
- `contracts/src/events.ts` and `contracts/src/events/` - Public re-export shims

**Event Categories:**

`SpreadsheetEvent` is the union in `types/events/src/index.ts`. Domain files
include cell, structure, merge, sheet, chart, pivot, selection, view, print,
settings, store, recalc, validation, data tools, table, floating object,
grouping, conditional formatting, sparkline, filter, comment, file I/O, named
range, slicer, scenario, ink/drawing, diagram, text effect, canvas object,
security, range, and sort events.

Connection status is exposed through connection/link APIs rather than
`connection:*` spreadsheet events in the current event union.

**Interface:**

```typescript
interface IEventBus<TEvent extends { type: string } = SpreadsheetEvent> {
  on<T extends TEvent>(type: T['type'], handler: EventHandler<T>): () => void;
  onMany(types: TEvent['type'][], handler: EventHandler<TEvent>): () => void;
  onAll(handler: AllEventsHandler<TEvent>): () => void;
  emit(event: TEvent): void;
  emitBatch(events: TEvent[]): void;
  clear(): void;
}
```

**Enables:** Reactive UI, decoupled domain listeners, batched semantic notifications.

---

## 3. Type System

**Purpose:** Schema language for cell/column types with validation and inference.

**Package:** `compute/core/crates/compute-schema/` (workspace-internal Rust)

**Contracts:** `contracts/src/core/schema.ts` (exported as `@mog-sdk/contracts/schema`)

**Storage:** Column schemas live under `sheets/{sheetIdHex}/schemas` keyed by
stable `ColId` hex. Public APIs accept column positions and translate through
the grid index. Range schemas/data validations are separate range-backed
storage (`validationRules`, `ranges`, and `rangeBindings`), not entries in the
column schema map.

**Type Hierarchy:**

```typescript
// Primitive types
type PrimitiveSchemaType = 'string' | 'number' | 'boolean' | 'date' | 'null';

// Semantic types with special validation/rendering
type SemanticSchemaType =
  | 'currency'
  | 'percentage'
  | 'integer'
  | 'email'
  | 'url'
  | 'phone'
  | 'time';

// Entity types for semantic enrichment
type EntitySchemaType = 'company' | 'person' | 'stock' | 'location';

// Special types for advanced features
type SpecialSchemaType = 'distribution' | 'any';

// Union of all types
type CellSchemaType =
  | PrimitiveSchemaType
  | SemanticSchemaType
  | EntitySchemaType
  | SpecialSchemaType;
```

**Schema Definition:**

```typescript
interface ColumnSchema {
  id: string;
  name: string;
  type: CellSchemaType;
  constraints?: SchemaConstraints;
  distribution?: DistributionConfig;
  defaultValue?: unknown; // Public TypeScript contract field.
  description?: string;
}

interface SchemaConstraints {
  required?: boolean;
  allowBlank?: boolean;
  min?: number;
  max?: number;
  exclusiveMin?: number;
  exclusiveMax?: number;
  equal?: unknown;
  notEqual?: unknown;
  notBetweenMin?: number;
  notBetweenMax?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: unknown[];
  enumSource?: IdentityRangeSchemaRef; // CellId-based range reference
  enumSourceFormula?: string; // INDIRECT support
  unique?: boolean;
  formula?: string;
}
```

**Key APIs:**

```typescript
interface ISchemaValidator {
  validate(value: unknown, schema: ColumnSchema): ValidationResult;
  inferType(value: unknown): CellSchemaType;
  inferColumnSchema(values: unknown[]): InferredSchema;
  coerce(value: unknown, targetType: CellSchemaType): CoercionResult;
  isCompatible(sourceType: CellSchemaType, targetType: CellSchemaType): boolean;
}
```

The public TypeScript contract includes `defaultValue`; the current Rust Yrs
column-schema storage persists `id`, `name`, `type`, `constraints`,
`distribution`, and `description`.

**Enables:** Typed columns, validation, API generation, and Monte Carlo
distribution metadata.

---

## 4. Workflow Versioning

**Purpose:** Workflow definition versioning and migration contracts for durable
workflows.

**Contracts:** `contracts/src/workflows/versioning.ts` re-exports
`types/api/src/workflows/versioning.ts`.

> **Note:** The current public repository does not expose a spreadsheet
> snapshot/branch manager contract here. `contracts/src/workflows/versioning.ts`
> is for workflow upgrades, not spreadsheet time-travel snapshots. The public
> repo currently has these as contract types; a public runtime
> `IVersionRegistry` implementation is not shipped.

```typescript
type VersioningStrategy = 'replace' | 'parallel' | 'migrate';

interface VersioningConfig {
  strategy: VersioningStrategy;
  gracePeriod?: string;
  defaultVersion?: 'latest' | 'previous' | string;
  migration?: MigrationConfig;
}

interface MigrationConfig {
  functionName: string;
  timing: 'immediate' | 'lazy';
  reversible: boolean;
  rollbackFunctionName?: string;
  batchSize?: number;
  timeout?: string;
}

interface WorkflowVersion {
  version: string;
  workflowId: string;
  active: boolean;
  deprecated: boolean;
  runningInstances: number;
  deployedAt: string;
}

interface VersionMetadata {
  commitHash?: string;
  branch?: string;
  description?: string;
  breakingChanges?: string[];
  migrationNotes?: string;
}

interface IVersionRegistry {
  register(workflowId: string, version: string, metadata?: VersionMetadata): Promise<void>;
  getVersions(workflowId: string): Promise<WorkflowVersion[]>;
  getLatestVersion(workflowId: string): Promise<WorkflowVersion | null>;
  getVersion(workflowId: string, version: string): Promise<WorkflowVersion | null>;
  activateVersion(workflowId: string, version: string): Promise<void>;
  deactivateVersion(workflowId: string, version: string): Promise<void>;
  deprecateVersion(workflowId: string, version: string, message: string): Promise<void>;
  getRunningInstanceCount(workflowId: string, version: string): Promise<number>;
}
```

**Enables:** Durable workflow upgrades, migration metadata, active/deprecated
version tracking.

---

## 5. Testing

**Purpose:** Unit-test contracts for spreadsheets with cell assertions, plus
workspace-internal helpers.

**Contracts:** `contracts/src/core/testing.ts` re-exports
`types/commands/src/testing.ts` and is published as `@mog-sdk/contracts/testing`.
**Implementation:** `runtime/spreadsheet-testing/` (`@mog/spreadsheet-testing`,
`private: true`; not a public SDK package)

**Storage:** `runtime/spreadsheet-testing/src/test-store.ts` uses plain
TypeScript `Map`s for assertions, suites, and config. It no longer stores tests
in a Yjs map.

```typescript
// Target for assertions - cell or range
type AssertionTarget =
  | { type: 'cell'; sheetId: string; row: number; col: number }
  | {
      type: 'range';
      sheetId: string;
      startRow: number;
      startCol: number;
      endRow: number;
      endCol: number;
    };

// Assertion types (lowercase)
type AssertionType =
  | 'equals'
  | 'notEquals'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterOrEqual'
  | 'lessOrEqual'
  | 'between'
  | 'notEmpty'
  | 'isEmpty'
  | 'isType'
  | 'isUnique'
  | 'matchesPattern'
  | 'noError'
  | 'formula';

interface AssertionParams {
  expected?: unknown;
  threshold?: number;
  min?: number;
  max?: number;
  expectedType?: 'string' | 'number' | 'boolean' | 'date' | 'error';
  pattern?: string;
  formula?: string;
  uniqueScope?: 'column' | 'row' | 'range';
}

interface CellAssertion {
  id: string;
  name?: string;
  target: AssertionTarget;
  type: AssertionType;
  params: AssertionParams;
  message?: string;
  severity: 'error' | 'warning' | 'info';
  enabled: boolean;
  createdAt?: number;
  updatedAt?: number;
}

interface ITestingFramework {
  // === Assertions CRUD ===
  addAssertion(assertion: Omit<CellAssertion, 'id'>): CellAssertion;
  updateAssertion(id: string, updates: Partial<CellAssertion>): void;
  removeAssertion(id: string): void;
  getAssertion(id: string): CellAssertion | undefined;
  getAssertionsForCell(sheetId: string, row: number, col: number): CellAssertion[];
  getAllAssertions(): CellAssertion[];

  // === Test Suites CRUD ===
  createSuite(name: string, options?: Partial<Omit<TestSuite, 'id' | 'name'>>): TestSuite;
  updateSuite(id: string, updates: Partial<TestSuite>): void;
  deleteSuite(id: string): void;
  getSuite(id: string): TestSuite | undefined;
  listSuites(): TestSuite[];
  addAssertionsToSuite(suiteId: string, assertionIds: string[]): void;
  removeAssertionsFromSuite(suiteId: string, assertionIds: string[]): void;

  // === Test Execution ===
  runAll(): Promise<TestResult[]>;
  runSuite(suiteId: string): Promise<TestResult[]>;
  runCell(sheetId: string, row: number, col: number): Promise<TestResult[]>;
  runAssertion(assertionId: string): Promise<TestResult | undefined>;

  // === Configuration ===
  setAutoRun(enabled: boolean): void;
  isAutoRunEnabled(): boolean;

  // === Events ===
  onTestsCompleted(handler: (results: TestResult[], summary: TestRunSummary) => void): () => void;
  onAssertionFailed(handler: (result: TestResult) => void): () => void;
}
```

**Enables:** Spreadsheet unit tests, suite execution, assertion failure notifications.

---

## 6. Connections

**Purpose:** External data/query contracts, sheet-level data bindings, and
cross-workbook link status/refresh APIs.

**Key files:**

- `contracts/src/connections/index.ts` - re-export for query formula contracts
- `types/connections/src/query.ts` - `QUERY` formula connection/query types
- `contracts/src/storage/connection.ts` - re-export for storage connection configs
- `types/document/src/storage/connection.ts` - connection config and table binding types
- `types/api/src/api/worksheet/bindings.ts` - worksheet sheet-data binding API
- `kernel/src/services/query-executor/query-executor.ts` - workspace-internal
  query cache/registry plumbing; database execution is disabled in this build
- `compute/core/src/storage/sheet/bindings/` - Rust/Yrs sheet binding storage
- `types/api/src/api/workbook.ts` and `kernel/src/services/workbook-links/` -
  cross-workbook link API and runtime service

```typescript
// Storage/table connection contracts
type DriverType = 'local' | 'postgres' | 'mysql' | 'sqlite' | 'rest' | 'graphql';
type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

interface BaseConnectionConfig {
  id: string;
  name: string;
  type: DriverType;
}

type ConnectionConfig =
  | PostgresConnectionConfig
  | MySQLConnectionConfig
  | SQLiteConnectionConfig
  | RestConnectionConfig
  | GraphQLConnectionConfig
  | LocalConnectionConfig;

interface TableBinding {
  tableId: TableId;
  connectionId: string;
  sourceConfig: SourceConfig;
}

// QUERY formula contracts
type QueryDatabaseType = 'clickhouse' | 'postgres' | 'mysql' | 'bigquery' | 'duckdb';
type QueryStatus = 'idle' | 'executing' | 'success' | 'error';

interface QueryFormulaSpec {
  connectionName: string;
  sql: string;
  parameters: QueryParameter[];
  refreshPolicy: QueryRefreshPolicy;
  includeHeaders: boolean;
}

// Sheet-level data bindings
interface ColumnMapping {
  columnIndex: number;
  dataPath: string;
  transform?: string;
  headerText?: string;
}

interface CreateBindingConfig {
  connectionId: string;
  columnMappings: ColumnMapping[];
  autoGenerateRows?: boolean;
  headerRow?: number;
  dataStartRow?: number;
  preserveHeaderFormatting?: boolean;
}

interface SheetDataBindingInfo {
  id: string;
  connectionId: string;
  columnMappings: ColumnMapping[];
  autoGenerateRows: boolean;
  headerRow: number;
  dataStartRow: number;
  preserveHeaderFormatting: boolean;
  lastRefresh?: number;
}

interface WorksheetBindings {
  list(): Promise<SheetDataBindingInfo[]>;
  get(bindingId: string): Promise<SheetDataBindingInfo | null>;
  getCount(): Promise<number>;
  clear(): Promise<void>;
  add(config: CreateBindingConfig): Promise<SheetDataBindingInfo>;
  remove(bindingId: string): Promise<void>;
  getProjectionRange(row: number, col: number): Promise<CellRange | null>;
  getProjectionSource(row: number, col: number): Promise<{ row: number; col: number } | null>;
  isProjectedPosition(row: number, col: number): Promise<boolean>;
  getViewportProjectionData(
    range: string | CellRange,
  ): Promise<Array<{ originRow: number; originCol: number; rows: number; cols: number }>>;
  getViewportProjectionData(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): Promise<Array<{ originRow: number; originCol: number; rows: number; cols: number }>>;
}

// Cross-workbook link API, exposed from Workbook.links.
type WorkbookLinkSourceKind = 'mog-workbook' | 'excel-workbook' | 'dde-link' | 'ole-link';
type LinkStatus = 'unresolved' | 'loading' | 'ready' | 'stale' | 'denied' | 'broken' | 'ambiguous';

interface WorkbookLinks {
  list(): readonly WorkbookLinkView[];
  get(linkId: LinkId): WorkbookLinkView | null;
  add(input: CreateWorkbookLinkInput): WorkbookLinkView;
  create(input: CreateWorkbookLinkInput): WorkbookLinkView;
  retarget(linkId: LinkId, input: RetargetWorkbookLinkInput): WorkbookLinkView;
  update(linkId: LinkId, input: UpdateWorkbookLinkInput): WorkbookLinkView;
  break(linkId: LinkId, options: BreakWorkbookLinkOptions): boolean;
  delete(linkId: LinkId): boolean;
  getStatus(linkId: LinkId): LinkStatusView;
  refresh(linkId: LinkId): Promise<LinkStatusView>;
  refreshAll(options?: { readonly concurrency?: number }): Promise<readonly LinkStatusView[]>;
  watchStatus(linkId: LinkId, handler: (status: LinkStatusView) => void): () => void;
  getUsages(linkId: LinkId): Promise<readonly WorkbookExternalLinkUsageView[]>;
  copySource(linkId: LinkId): Promise<CopyWorkbookLinkSourceResult>;
  listPackageDiagnostics(): Promise<readonly WorkbookExternalPackageArtifactView[]>;
}
```

**Storage:** Sheet-level data bindings are position-based and stored per sheet
in a `bindings` Y.Map keyed by binding ID. Storage/table connection config
contracts do not include credentials; the workspace-internal query executor has
its own in-memory registry type and currently returns an unsupported execution
error on cache misses.

**Providers and link kinds:**

- **Table/storage connection configs:** local, PostgreSQL, MySQL, SQLite, REST, GraphQL
- **QUERY formula database handles:** ClickHouse, PostgreSQL, MySQL, BigQuery, DuckDB
  contract names; external database execution is not shipped in the current
  public build
- **Workbook links:** Mog workbook, Excel workbook, DDE, and OLE link records with status/refresh APIs

**Enables:** QUERY formula contract/cache plumbing, sheet data projections,
table-backed storage contracts, and cross-workbook link status/refresh
workflows.

---

## Foundation Dependencies

| Feature           | Metadata | Events | Types | Workflows | Testing | Connections |
| ----------------- | :------: | :----: | :---: | :-------: | :-----: | :---------: |
| Provenance        |   yes    |  yes   |       |           |         |             |
| Reactive UI       |   yes    |  yes   |       |           |         |             |
| Typed Columns     |          |        |  yes  |           |         |             |
| Workflow Upgrades |          |        |       |    yes    |         |             |
| Unit Tests        |          |        |       |           |   yes   |             |
| Live Data         |   yes    |        |       |           |         |     yes     |

---

## Implementation Status

| Foundation | Status | Package/File |
| --- | --- | --- |
| Cell Metadata | Shipped public TypeScript contract; workspace-internal Rust/Yrs storage | `types/core/src/core.ts`, `contracts/src/core/core.ts`, `compute/core/crates/compute-document/src/schema.rs`, `compute/core/src/storage/properties/` |
| Event Bus | Public event types; workspace-internal bus implementation | `types/events/src/`, `contracts/src/events.ts`, `kernel/src/context/event-bus.ts` |
| Type System | Shipped public contracts; workspace-internal Rust validation/storage | `contracts/src/core/schema.ts`, `compute/core/crates/compute-schema/`, `compute/core/src/storage/sheet/schemas/` |
| Workflow Versioning | Shipped public contract types; public runtime registry not shipped | `types/api/src/workflows/versioning.ts`, `contracts/src/workflows/versioning.ts` |
| Testing | Shipped public contract types; workspace-internal helper package | `contracts/src/core/testing.ts`, `types/commands/src/testing.ts`, `runtime/spreadsheet-testing/` |
| Connections | Mixed public contracts/API plus workspace-internal services/storage; external query execution not shipped in this build | `types/connections/src/query.ts`, `types/document/src/storage/connection.ts`, `types/api/src/api/worksheet/bindings.ts`, `types/api/src/api/workbook.ts`, `kernel/src/services/query-executor/query-executor.ts`, `compute/core/src/storage/sheet/bindings/`, `kernel/src/services/workbook-links/` |
