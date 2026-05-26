/**
 * Profiler Types - Deep performance profiling for the spreadsheet engine.
 *
 * These types power the hierarchical phase-based profiler that instruments
 * import pipelines, Rust WASM parsers, and recalc engines.
 *
 * Key design:
 * - PhaseNode is the core primitive: a hierarchical timing tree
 * - ProfileContext is nullable/optional for zero-cost when not profiling
 * - Layers separate Rust compute, WASM boundary, and JS processing
 * - Hotspot/Bottleneck analysis runs as a post-processing step
 */

// =============================================================================
// Duck-Typed Profiler Interface (for cross-package use)
// =============================================================================

/**
 * Duck-typed profiler interface for injectable profiling.
 *
 * This interface allows packages like file-io and xlsx-parser to accept
 * a profiler without depending on the @mog/performance package.
 * The actual ProfileContext class in @mog/performance satisfies this interface.
 *
 * Usage (zero-cost when profiler is undefined):
 *   profiler?.begin('phase');
 *   // ... do work ...
 *   profiler?.end('phase');
 *
 *   profiler?.tick('hotOp');
 *   // ... per-iteration work ...
 *   profiler?.endTick('hotOp');
 */
export interface Profiler {
  begin(name: string): void;
  end(name: string): void;
  tick(name: string): void;
  endTick(name: string): void;
  snapshotMemory(label: string): void;
  recordRustTimings(timings: RustPhaseTimings): void;
}

// =============================================================================
// Core Profiling Primitive — Hierarchical Phase Tree
// =============================================================================

/**
 * Hierarchical timing tree node — the core profiling primitive.
 *
 * Every profiled operation is decomposed into a tree of phases.
 * Parent duration = selfMs + sum(children.durationMs).
 */
export interface PhaseNode {
  /** Phase name (e.g., 'zipDecompress', 'sharedStrings.parse') */
  name: string;

  /** Total duration including children (ms) */
  durationMs: number;

  /** Self time excluding children (ms) */
  selfMs: number;

  /** Percentage of root total duration */
  percentage: number;

  /** Number of times this phase was invoked */
  callCount: number;

  /** Average time per invocation (microseconds) */
  avgPerCallUs: number;

  /** Child phases */
  children: PhaseNode[];

  /** Optional source code location for linking to code */
  codeLocation?: string;

  /** Number of timed ticks (ticks that had endTick called). Used for accurate avgPerCallUs in hotspot analysis. */
  timedCount?: number;
}

// =============================================================================
// Top-Level Profile Result
// =============================================================================

/**
 * Top-level profile result for any profiled operation.
 *
 * Contains the full phase tree split into layers (Rust, WASM boundary, JS),
 * plus automated hotspot and bottleneck analysis.
 */
export interface PerformanceProfile {
  /** Which operation was profiled */
  operation: 'import' | 'export' | 'recalc';

  /** Total wall-clock time (ms) */
  totalMs: number;

  /** ISO timestamp when profiling started */
  timestamp: string;

  /** Profile split by execution layer */
  layers: {
    rustCompute?: RustLayerProfile;
    wasmBoundary?: WasmBoundaryProfile;
    jsProcessing: JsLayerProfile;
  };

  /** Top time-consuming phases sorted by selfMs */
  hotspots: Hotspot[];

  /** Detected performance bottlenecks with suggestions */
  bottlenecks: Bottleneck[];

  /** Metadata about the profiled workbook and environment */
  metadata: ProfileMetadata;

  /** Optional memory waterfall (snapshots over time) */
  memoryProfile?: MemoryWaterfall;
}

// =============================================================================
// Profile Metadata
// =============================================================================

/**
 * Metadata about the profiled workbook and execution environment.
 */
export interface ProfileMetadata {
  /** Scale preset name (e.g., 'LARGE', 'EXTREME') */
  scale: string;

  /** Total cell count in the workbook */
  cellCount: number;

  /** Total formula count */
  formulaCount: number;

  /** Number of sheets */
  sheetCount: number;

  /** File size in bytes (for import/export) */
  fileSizeBytes: number;

  /** Runtime environment details */
  environment: {
    platform: string;
    nodeVersion: string;
    wasmSimd: boolean;
    sharedArrayBuffer: boolean;
  };
}

// =============================================================================
// Layer Profiles
// =============================================================================

/**
 * Profile for Rust-side computation (inside WASM).
 */
export interface RustLayerProfile {
  /** Total Rust compute time (ms) */
  totalMs: number;

  /** Percentage of overall operation time */
  percentage: number;

  /** Phase tree for Rust-side operations */
  phases: PhaseNode;
}

/**
 * Flat timing data received from Rust via WASM.
 *
 * This is the raw struct that Rust reports — the profiler converts it
 * into a PhaseNode tree via recordRustTimings().
 */
export interface RustPhaseTimings {
  zip_index_us: number;
  shared_strings_us: number;
  styles_us: number;
  metadata_us: number;
  per_sheet_us: Array<{
    sheet_index: number;
    xml_scan_us: number;
    cell_extract_us: number;
    features_us: number;
  }>;
  serde_serialize_us: number;
  total_us: number;
}

/**
 * Profile for the WASM boundary crossing (Rust <-> JS data transfer).
 */
export interface WasmBoundaryProfile {
  /** Total boundary crossing time (ms) */
  totalMs: number;

  /** Percentage of overall operation time */
  percentage: number;

  /** Which transfer path was used */
  path: 'binary-buffer' | 'serde-full';

  /** Binary buffer path details (SharedArrayBuffer + DataView) */
  binaryPath?: {
    dataViewReadsMs: number;
    textDecoderMs: number;
    typeConversionMs: number;
    objectAllocationMs: number;
    totalCells: number;
    bytesTransferred: number;
  };

  /** Serde full path details (serde_wasm_bindgen) */
  serdePath?: {
    rustSerializationMs: number;
    jsHydrationMs: number;
    payloadSizeEstimate: number;
  };

  /** Breakdown by cell value type */
  byValueType?: Record<string, { count: number; totalMs: number; avgUs: number }>;

  /** Phase tree for WASM boundary operations (when available) */
  phases?: PhaseNode;

  /** Throughput: cells decoded per second */
  cellsPerSecond: number;

  /** Ratio of boundary time to total time (higher = more overhead) */
  overheadRatio: number;
}

/**
 * Profile for JavaScript-side processing.
 */
export interface JsLayerProfile {
  /** Total JS processing time (ms) */
  totalMs: number;

  /** Percentage of overall operation time */
  percentage: number;

  /** Phase tree for JS-side operations */
  phases: PhaseNode;
}

// =============================================================================
// Hotspot Analysis
// =============================================================================

/**
 * A performance hotspot — a phase consuming significant time.
 */
export interface Hotspot {
  /** Rank (1 = highest self time) */
  rank: number;

  /** Phase name */
  phase: string;

  /** Self time excluding children (ms) */
  selfMs: number;

  /** Percentage of total operation time */
  percentage: number;

  /** Number of invocations */
  callCount: number;

  /** Average time per call (microseconds) */
  avgPerCallUs: number;

  /** Source code location */
  codeLocation: string;
}

// =============================================================================
// Bottleneck Detection
// =============================================================================

/**
 * A detected performance bottleneck with actionable suggestion.
 */
export interface Bottleneck {
  /** How severe the bottleneck is */
  severity: 'critical' | 'major' | 'minor';

  /** What kind of bottleneck */
  category: 'cpu' | 'memory' | 'io' | 'boundary' | 'gc';

  /** Which phase is the bottleneck */
  phase: string;

  /** Human-readable description */
  description: string;

  /** Current time spent (ms) */
  currentMs: number;

  /** Percentage of total operation time */
  percentageOfTotal: number;

  /** Actionable suggestion for fixing */
  suggestion: string;

  /** Source code location */
  codeLocation: string;

  /** Call pattern details (for high-frequency bottlenecks) */
  callPattern?: {
    callCount: number;
    avgPerCallUs: number;
    recommendation: string;
  };
}

/**
 * A rule for detecting bottlenecks in a profile.
 *
 * Used by the bottleneck detection engine. Each rule inspects
 * the phase tree and optionally returns a Bottleneck.
 */
export interface BottleneckRule {
  /** Unique rule identifier */
  id: string;

  /** Detection function — returns a Bottleneck if the rule fires */
  detect: (phases: PhaseNode, metadata?: ProfileMetadata) => Bottleneck | undefined;
}

// =============================================================================
// Profile Comparison
// =============================================================================

/**
 * Comparison between two profiles (before/after optimization).
 */
export interface ProfileComparison {
  /** Profile summary before the change */
  before: ProfileSummary;

  /** Profile summary after the change */
  after: ProfileSummary;

  /** Total time delta */
  totalDelta: { ms: number; percent: number };

  /** Per-layer deltas */
  layerDeltas: {
    rustCompute?: { ms: number; percent: number };
    wasmBoundary?: { ms: number; percent: number };
    jsProcessing: { ms: number; percent: number };
  };

  /** Per-phase deltas with significance */
  phaseDeltas: Array<{
    phase: string;
    beforeMs: number;
    afterMs: number;
    deltaMs: number;
    deltaPercent: number;
    significance: 'significant' | 'marginal' | 'noise';
  }>;

  /** Bottlenecks that were resolved */
  resolvedBottlenecks: Bottleneck[];

  /** New bottlenecks introduced */
  newBottlenecks: Bottleneck[];
}

/**
 * Subset of PerformanceProfile used for comparisons.
 */
export interface ProfileSummary {
  /** Which operation was profiled */
  operation: 'import' | 'export' | 'recalc';

  /** Total wall-clock time (ms) */
  totalMs: number;

  /** ISO timestamp */
  timestamp: string;

  /** Layer summaries (just totals and percentages) */
  layers: {
    rustCompute?: { totalMs: number; percentage: number };
    wasmBoundary?: { totalMs: number; percentage: number };
    jsProcessing: { totalMs: number; percentage: number };
  };

  /** Metadata about the profiled workbook */
  metadata: ProfileMetadata;
}

// =============================================================================
// Memory Profiling
// =============================================================================

/**
 * Memory waterfall — snapshots taken at key phases during profiling.
 */
export interface MemoryWaterfall {
  /** Ordered memory snapshots */
  snapshots: ProfileMemorySnapshot[];

  /** Peak heap used across all snapshots (bytes) */
  peakHeapUsed: number;

  /** Peak heap total across all snapshots (bytes) */
  peakHeapTotal: number;
}

/**
 * A single memory snapshot taken during profiling.
 */
export interface ProfileMemorySnapshot {
  /** Human-readable label */
  label: string;

  /** Which phase this snapshot was taken in */
  phase: string;

  /** Timestamp relative to profile start (ms) */
  timestampMs: number;

  /** Heap used (bytes) */
  heapUsed: number;

  /** Heap total (bytes) */
  heapTotal: number;

  /** External memory (bytes) */
  external: number;

  /** ArrayBuffer memory (bytes) */
  arrayBuffers: number;
}
