# Core Foundations

## Overview

These foundations are the current public contracts and runtime/storage pieces
behind spreadsheet metadata, validation, testing, links, and eventing. Rust/Yrs
backs sheet storage where noted; some APIs are TypeScript-only.

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

**Purpose:** Per-cell key-value data beyond value/formula/format.

**Storage:** Embedded in the per-sheet `properties` map keyed by `CellId`
(`CellProperties`), with the map declared in `contracts/src/store/sheet-maps-schema.ts`.

> **Note:** Cell metadata is stored as part of the unified `CellProperties` structure, not as a separate Yrs map. This eliminates redundancy and simplifies CRDT merges.

**Key files:**

- `types/core/src/core.ts` - source for `CellMetadata` and `CellProperties`
- `contracts/src/core/core.ts` - public re-export and helper exports
- `compute/core/src/storage/properties/cell.rs` - Rust/Yrs cell property storage helpers

```typescript
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

**Enables:** Provenance tracking, validation UI, live data indicators, formula auditing.

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
interface IEventBus {
  on<T extends SpreadsheetEvent>(type: T['type'], handler: EventHandler<T>): () => void;
  onMany(types: SpreadsheetEvent['type'][], handler: EventHandler<SpreadsheetEvent>): () => void;
  onAll(handler: AllEventsHandler): () => void;
  emit(event: SpreadsheetEvent): void;
  emitBatch(events: SpreadsheetEvent[]): void;
  clear(): void;
}
```

**Enables:** Reactive UI, decoupled domain listeners, batched semantic notifications.

---

## 3. Type System

**Purpose:** Schema language for cell/column types with validation and inference.

**Package:** `compute/core/crates/compute-schema/` (Rust)

**Contracts:** `contracts/src/core/schema.ts` (exported as `@mog-sdk/contracts/schema`)

**Storage:** `sheets/{sheetId}/schemas: Y.Map<colIndex, ColumnSchema>`

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
  defaultValue?: unknown;
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

**Enables:** Typed cells, API generation, Monte Carlo distributions.

---

## 4. Workflow Versioning

**Purpose:** Workflow definition versioning and migration for durable workflows.

**Contracts:** `contracts/src/workflows/versioning.ts` re-exports
`types/api/src/workflows/versioning.ts`.

> **Note:** The current public repository does not expose a spreadsheet
> snapshot/branch manager contract here. `contracts/src/workflows/versioning.ts`
> is for workflow upgrades, not spreadsheet time-travel snapshots.

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

**Purpose:** Unit tests for spreadsheets with cell assertions.

**Contracts:** `contracts/src/core/testing.ts` re-exports
`types/commands/src/testing.ts` and is published as `@mog-sdk/contracts/testing`.
**Implementation:** `runtime/spreadsheet-testing/`

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

**Purpose:** External data/query surfaces, sheet-level data bindings, and
cross-workbook link status/refresh APIs.

**Key files:**

- `contracts/src/connections/index.ts` - re-export for query formula contracts
- `types/connections/src/query.ts` - `QUERY` formula connection/query types
- `contracts/src/storage/connection.ts` - re-export for storage connection configs
- `types/document/src/storage/connection.ts` - connection config and table binding types
- `types/api/src/api/worksheet/bindings.ts` - worksheet sheet-data binding API
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
}
```

**Storage:** Sheet-level data bindings are position-based and stored per sheet
in a `bindings` Y.Map keyed by binding ID. Connection credentials are not part
of the connection config contracts.

**Providers and link kinds:**

- **Table/storage connection configs:** local, PostgreSQL, MySQL, SQLite, REST, GraphQL
- **QUERY formula database handles:** ClickHouse, PostgreSQL, MySQL, BigQuery, DuckDB
- **Workbook links:** Mog workbook, Excel workbook, DDE, and OLE link records with status/refresh APIs

**Enables:** QUERY formulas, sheet data projections, table-backed storage, and
cross-workbook link status/refresh workflows.

---

## Foundation Dependencies

| Feature           | Metadata | Events | Types | Workflows | Testing | Connections |
| ----------------- | :------: | :----: | :---: | :-------: | :-----: | :---------: |
| Provenance        |    ✓     |   ✓    |       |           |         |             |
| Reactive UI       |    ✓     |   ✓    |       |           |         |             |
| Typed Cells       |    ✓     |   ✓    |   ✓   |           |         |             |
| Workflow Upgrades |          |        |       |     ✓     |         |             |
| Unit Tests        |    ✓     |   ✓    |       |           |    ✓    |             |
| Live Data         |    ✓     |   ✓    |       |           |         |      ✓      |

---

## Implementation Status

| Foundation    | Status  | Package/File                                   |
| ------------- | ------- | ---------------------------------------------- |
| Cell Metadata | ✅ Done | `types/core/src/core.ts`, `contracts/src/store/sheet-maps-schema.ts`, `compute/core/src/storage/properties/` |
| Event Bus     | ✅ Done | `kernel/src/context/event-bus.ts`              |
| Type System   | ✅ Done | `compute/core/crates/compute-schema/`, `contracts/src/core/schema.ts` |
| Workflow Versioning | ✅ Done | `types/api/src/workflows/versioning.ts` |
| Testing       | ✅ Done | `contracts/src/core/testing.ts`, `runtime/spreadsheet-testing/` |
| Connections   | ✅ Done | `types/connections/src/query.ts`, `types/document/src/storage/connection.ts`, `compute/core/src/storage/sheet/bindings/` |
