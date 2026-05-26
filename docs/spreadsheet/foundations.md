# Core Foundations

## Overview

Six foundational systems enable advanced features. Built on Rust/Yrs for collaboration sync.

```
┌─────────────────────────────────────────────────────────────────────┐
│                     CONSUMER FEATURES                                │
│  AI Agents │ Self-Healing │ Provenance │ Live Data │ Time Travel    │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        FOUNDATIONS                                   │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐                         │
│  │  Metadata │ │  EventBus │ │   Types   │                         │
│  └───────────┘ └───────────┘ └───────────┘                         │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐                         │
│  │ Versioning│ │  Testing  │ │Connections│                         │
│  └───────────┘ └───────────┘ └───────────┘                         │
└─────────────────────────────────────────────────────────────────────┘
```

## 1. Cell Metadata

**Purpose:** Per-cell key-value data beyond value/formula/format.

**Storage:** Embedded in `sheets/{sheetId}/properties: Y.Map<CellId, CellProperties>`

> **Note:** Cell metadata is stored as part of the unified `CellProperties` structure, not as a separate Yrs map. This eliminates redundancy and simplifies CRDT merges.

**Key file:** `contracts/src/core.ts`

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

  // === Formula Auditing (Stream B2) ===
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
- `contracts/src/events/` - Full type definitions (event types across 30+ files)

**Event Categories:**

| Category              | Events                                                                                                                                                                                                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cell**              | `cell:changed`, `cells:batch-changed`, `cell:format-changed`, `cell:borders-changed`, `cell:metadata-changed`                                                                                                                                                                                                    |
| **Structure**         | `rows:inserted`, `rows:deleted`, `columns:inserted`, `columns:deleted`, `row:height-changed`, `column:width-changed`, `rows:hidden`, `rows:unhidden`, `columns:hidden`, `columns:unhidden`                                                                                                                       |
| **Merge**             | `cells:merged`, `cells:unmerged`, `merges:changed`                                                                                                                                                                                                                                                               |
| **Sheet**             | `sheet:created`, `sheet:deleted`, `sheet:renamed`, `sheet:reordered`, `sheet:colorChanged`, `sheet:visibilityChanged`, `sheet:moved`, `sheet:copied`                                                                                                                                                             |
| **Chart**             | `chart:created`, `chart:updated`, `chart:deleted`, `chart:moved`                                                                                                                                                                                                                                                 |
| **Pivot**             | `pivot:created`, `pivot:updated`, `pivot:deleted`, `pivot:expansion-changed`                                                                                                                                                                                                                                     |
| **Selection**         | `selection:changed`                                                                                                                                                                                                                                                                                              |
| **View**              | `freeze:changed`, `view:options-changed`                                                                                                                                                                                                                                                                         |
| **Scroll**            | `scroll:changed`, `viewport:resized`                                                                                                                                                                                                                                                                             |
| **Print**             | `print:page-breaks-changed`, `print:area-changed`, `print:titles-changed`, `print:page-break-drag-start`, `print:page-break-drag-end`, `print:pdf-export-progress`, `print:pdf-export-complete`                                                                                                                  |
| **Settings**          | `workbook:settings-changed`, `sheet:settings-changed`, `sheet:print-settings-changed`, `workbook:theme-changed`                                                                                                                                                                                                  |
| **Store**             | `store:ready`, `store:sync-error`                                                                                                                                                                                                                                                                                |
| **Recalc**            | `recalc:started`, `recalc:completed`                                                                                                                                                                                                                                                                             |
| **Schema**            | `validation:failed`, `validation:passed`, `schema:changed`, `schemas:inferred`, `range-schema:created`, `range-schema:updated`, `range-schema:deleted`                                                                                                                                                           |
| **DataTools**         | `duplicates:removed`, `text:split`                                                                                                                                                                                                                                                                               |
| **Table**             | `table:created`, `table:updated`, `table:deleted`, `table:resized`, `table:column-renamed`, `table:total-row-changed`, `table:renamed`, `table:calculated-column-filled`, `table:duplicates-removed`, `table:column-deleted`, `table:converted-to-range`                                                         |
| **FloatingObject**    | `floatingObject:created`, `floatingObject:updated`, `floatingObject:deleted`, `floatingObject:moved`, `floatingObject:resized`, `floatingObject:zOrderChanged`, `floatingObject:grouped`, `floatingObject:ungrouped`, `floatingObject:selectionChanged`                                                          |
| **Grouping**          | `group:created`, `group:deleted`, `group:collapsed`, `outline:settings-changed`, `outline:level-changed`, `outline:auto-applied`, `subtotals:created`, `subtotals:removed`                                                                                                                                       |
| **ConditionalFormat** | `cf:rules-changed`, `cf:rule-created`, `cf:rule-deleted`, `cf:rule-updated`                                                                                                                                                                                                                                      |
| **Sparkline**         | `sparkline:created`, `sparkline:updated`, `sparkline:deleted`, `sparklineGroup:created`, `sparklineGroup:updated`, `sparklineGroup:deleted`, `sparklines:cleared`, `sparkline:dataChanged`                                                                                                                       |
| **Connection**        | `connection:created`, `connection:updated`, `connection:deleted`, `connection:status-changed`, `connection:cell-bound`, `connection:cell-unbound`, `connection:refreshed`, `connection:data-stale`, `connection:sheet-binding-created`, `connection:sheet-binding-refreshed`, `connection:sheet-binding-removed` |
| **Filter**            | `filter:created`, `filter:updated`, `filter:applied`, `filter:deleted`, `filter:cleared`                                                                                                                                                                                                                         |
| **Comment**           | `comment:added`, `comment:updated`, `comment:deleted`, `comment:resolved`, `comments:cleared`                                                                                                                                                                                                                    |
| **NamedRange**        | `name:created`, `name:updated`, `name:deleted`                                                                                                                                                                                                                                                                   |
| **FileIO**            | `export:progress`, `export:complete`, `import:progress`, `import:complete`                                                                                                                                                                                                                                       |
| **Slicer**            | `slicer:created`, `slicer:updated`, `slicer:deleted`, `slicer:selectionChanged`, `slicer:cacheInvalidated`, `slicer:disconnected`                                                                                                                                                                                |

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

**Enables:** Reactive UI, self-healing triggers, webhook integration.

---

## 3. Type System

**Purpose:** Schema language for cell/column types with validation and inference.

**Package:** `compute/core/crates/compute-schema/` (Rust)

**Contracts:** `contracts/src/schema.ts`

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
  min?: number;
  max?: number;
  exclusiveMin?: number;
  exclusiveMax?: number;
  equal?: number;
  notEqual?: number;
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

## 4. Versioning

**Purpose:** Git-like version control for spreadsheets.

**Contracts:** `contracts/src/workflows/versioning.ts`

**Storage:** `versioning: Y.Map` (metadata) + IndexedDB (blobs)

```typescript
interface ListSnapshotsOptions {
  branch?: string;
  limit?: number;
  offset?: number;
}

interface IVersionManager {
  // === Snapshots ===
  createSnapshot(message?: string): Promise<Snapshot>;
  listSnapshots(options?: ListSnapshotsOptions): Promise<SnapshotMetadata[]>;
  getSnapshot(id: string): Promise<Snapshot | undefined>;

  // === Branches ===
  createBranch(name: string, fromSnapshot?: string): Promise<Branch>;
  listBranches(): Branch[];
  getCurrentBranch(): string;
  checkout(branchName: string): Promise<void>;
  deleteBranch(name: string): boolean;

  // === Diff & Merge ===
  diff(fromId: string, toId: string): Promise<SnapshotDiff>;
  merge(sourceBranch: string, targetBranch?: string): Promise<MergeResult>;

  // === Utility (implementation-only, not in contract interface) ===
  // Note: The following methods exist in implementation but are not part of
  // the contract interface: diffWithCurrent, previewMerge, hasUncommittedChanges,
  // getHistory, restoreToSnapshot
}
```

**Enables:** Time travel, branching scenarios, diff/merge, audit trail.

---

## 5. Testing

**Purpose:** Unit tests for spreadsheets with cell assertions.

**Contracts:** `contracts/src/core/testing.ts`
**Implementation:** testing contracts are defined in `contracts/src/core/testing.ts`.

**Storage:** `testing: Y.Map` (assertions, suites)

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

**Enables:** Spreadsheet unit tests, CI/CD validation, self-diagnosing errors.

---

## 6. Connections

**Purpose:** Live data from external sources and cross-spreadsheet links.

**Contracts:** `contracts/src/connections/`

**Storage:** `connections: Y.Map` (configs, bindings)

```typescript
type ConnectionType = 'rest' | 'graphql' | 'remote-sheet' | 'websocket' | 'database';

// Status values
type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'refreshing' | 'stale' | 'error';

interface DataConnection {
  id: string;
  name: string;
  type: ConnectionType;
  endpoint?: string;
  query?: string;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: string;
  remoteDocId?: string;
  remoteRange?: string;
  refreshInterval?: number;
  lastRefresh?: number;
  timeout?: number;
  status: ConnectionStatus;
  error?: string;
  createdAt: number;
  createdBy?: string;
  modifiedAt?: number;
}

// Cell bindings use CellId (not position) for CRDT safety
interface CellBinding {
  connectionId: string;
  cellId: CellId; // Stable cell identifier
  sheetId: SheetId;
  query: string;
  transform?: string;
}

// Sheet-level data bindings (position-based, not CellId-based)
interface SheetDataBinding {
  id: string;
  sheetId: SheetId;
  connectionId: string;
  columnMappings: ColumnMapping[];
  autoGenerateRows: boolean;
  headerRow: number;
  dataStartRow: number;
  lastRowCount?: number;
  lastRefresh?: number;
  preserveHeaderFormatting?: boolean;
}

// Column mapping for sheet data bindings
interface ColumnMapping {
  sourceField: string; // Field name in the data source
  targetColumn: number; // Target column index in the sheet
  transform?: string; // Optional transformation expression
}

// Result of refreshing a sheet binding
interface SheetBindingRefreshResult {
  bindingId: string;
  success: boolean;
  rowsUpdated: number;
  rowsAdded: number;
  rowsRemoved: number;
  error?: string;
}

interface IConnectionManager {
  // === Connection CRUD ===
  createConnection(config: Omit<DataConnection, 'id' | 'status' | 'createdAt'>): DataConnection;
  updateConnection(id: string, config: Partial<DataConnection>): void;
  deleteConnection(id: string): boolean;
  getConnection(id: string): DataConnection | undefined;
  listConnections(options?: ListConnectionsOptions): DataConnection[];

  // === Credentials (in-memory only) ===
  setCredentials(
    connectionId: string,
    credentials: Omit<ConnectionCredentials, 'connectionId'>
  ): void;
  clearCredentials(connectionId: string): void;

  // === Cell Bindings (CellId-based) ===
  bindCell(
    cellId: CellId,
    sheetId: SheetId,
    connectionId: string,
    query: string,
    transform?: string
  ): void;
  unbindCell(cellId: CellId): boolean;
  getCellBinding(cellId: CellId): CellBinding | undefined;
  getCellIdsForConnection(connectionId: string): CellId[];
  getBindingsForSheet(sheetId: SheetId): CellBinding[];
  getAllBindings(): CellBinding[];

  // === Cell Bindings (Position-based convenience API) ===
  bindCellAtPosition(
    sheetId: SheetId,
    row: number,
    col: number,
    connectionId: string,
    query: string,
    lookup: ICellPositionLookup,
    transform?: string
  ): CellId;
  getCellBindingAtPosition(
    sheetId: SheetId,
    row: number,
    col: number,
    lookup: ICellPositionLookup
  ): CellBinding | undefined;

  // === Refresh Operations ===
  refresh(connectionId: string, lookup: ICellPositionLookup): Promise<RefreshResult>;
  refreshAll(lookup: ICellPositionLookup): Promise<RefreshResult[]>;
  startAutoRefresh(): void;
  stopAutoRefresh(): void;
  setPositionLookup(lookup: ICellPositionLookup): void;

  // === Status ===
  getStatus(connectionId: string): ConnectionStatus | undefined;

  // === Event Subscriptions ===
  onStatusChanged(
    handler: (
      connectionId: string,
      oldStatus: ConnectionStatus,
      newStatus: ConnectionStatus
    ) => void
  ): () => void;
  onDataRefreshed(handler: (result: RefreshResult) => void): () => void;
  onError(handler: (connectionId: string, error: string) => void): () => void;
}
```

**Providers:**

- **REST/GraphQL:** HTTP endpoints with JSONPath extraction
- **Remote Sheet:** Cross-spreadsheet cell references
- **WebSocket:** Real-time streaming data
- **Database:** SQL database (via backend proxy)

**Enables:** Live stock prices, API data, linked spreadsheets.

---

## Foundation Dependencies

| Feature      | Metadata | Events | Types | Versioning | Testing | Connections |
| ------------ | :------: | :----: | :---: | :--------: | :-----: | :---------: |
| Provenance   |    ✓     |   ✓    |       |     ✓      |         |             |
| Self-Healing |    ✓     |   ✓    |   ✓   |            |         |             |
| Typed Cells  |    ✓     |   ✓    |   ✓   |            |         |             |
| Time Travel  |          |        |       |     ✓      |         |             |
| Unit Tests   |    ✓     |   ✓    |       |            |    ✓    |             |
| Live Data    |    ✓     |   ✓    |       |            |         |      ✓      |

---

## Implementation Status

| Foundation    | Status  | Package/File                                   |
| ------------- | ------- | ---------------------------------------------- |
| Cell Metadata | ✅ Done | `contracts/src/core.ts`                        |
| Event Bus     | ✅ Done | `kernel/src/context/event-bus.ts`              |
| Type System   | ✅ Done | `compute/core/crates/compute-schema/`, `contracts/src/schema.ts` |
| Versioning    | ✅ Done | `contracts/src/workflows/versioning.ts`        |
| Testing       | ✅ Done | `contracts/src/core/testing.ts`                 |
| Connections   | ✅ Done | `contracts/src/connections/`                   |
