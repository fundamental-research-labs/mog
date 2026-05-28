//! Execution Journal — structured runtime path tracing for agent debugging.
//!
//! The journal captures what happened (decisions, data mutations, cache interactions)
//! during formula recalculation, as opposed to timing/profiling data.
//!
//! ## Usage
//!
//! All functionality is gated behind the `journal` feature flag.
//! When disabled, all macros compile to nothing (zero overhead).
//!
//! ```rust,ignore
//! use compute_core::journal;
//!
//! // Install a collector before recalc
//! journal::install(JournalCollector::new());
//!
//! // ... run recalc (macros emit events) ...
//!
//! // Take collected events
//! let collector = journal::take().unwrap();
//! let entries = collector.take_entries();
//! ```

use std::cell::RefCell;
use std::collections::HashSet;

use cell_types::{CellId, SheetId};
use value_types::CellValue;

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

/// All journal event variants. String fields carry human-readable summaries;
/// `&'static str` fields are compile-time tags (zero allocation).
#[derive(Debug)]
pub enum JournalEvent {
    // === Recalc Envelope ===
    RecalcStart {
        mode: &'static str,
        total_formula_cells: u32,
    },
    RecalcEnd {
        changed_count: u32,
        projection_delta_count: u32,
    },

    // === Scheduling ===
    LevelStart {
        level_index: u32,
        total_levels: u32,
        cell_count: u32,
        parallel: bool,
    },
    AggPrepassResolved {
        cell: CellId,
        function: &'static str,
        value_summary: String,
    },

    // === Evaluation ===
    EvalStart {
        cell: CellId,
        sheet: String,
        row: u32,
        col: u32,
        formula: String,
    },
    EvalResult {
        cell: CellId,
        value_type: &'static str,
        value_summary: String,
    },

    // === Phase Boundaries ===
    ParallelApplyStart {
        level: u32,
        cell_count: u32,
    },

    // === Spill Handling Boundaries ===
    SpillHandlingStart {
        cell: CellId,
        sheet: SheetId,
        has_old_projection: bool,
    },
    SpillHandlingEnd {
        cell: CellId,
        outcome: &'static str,
    },

    // === Decision Points ===
    Decision {
        cell: CellId,
        point: &'static str,
        condition: String,
        path: &'static str,
    },

    // === Data Mutations ===
    Write {
        sheet: SheetId,
        row: u32,
        col: u32,
        old_value: String,
        new_value: String,
        source: &'static str,
        cell: Option<CellId>,
    },
    EntryWrite {
        cell: CellId,
        field: &'static str,
        old_value: String,
        new_value: String,
        source: &'static str,
    },

    // === Projection Operations ===
    ProjectionRegister {
        source: CellId,
        sheet: SheetId,
        origin: (u32, u32),
        size: (u32, u32),
    },
    ProjectionMaterializeStart {
        source: CellId,
        target_count: u32,
    },
    ProjectionMaterializeCell {
        source: CellId,
        row: u32,
        col: u32,
        value: String,
    },
    ProjectionClear {
        source: CellId,
        origin: (u32, u32),
        size: (u32, u32),
    },
    ProjectionConflict {
        source: CellId,
        conflicting_cell: CellId,
        at: (u32, u32),
    },
    ProjectionStabilizeStart {
        depth: u32,
        delta_count: u32,
        affected_count: u32,
    },

    // === Cache Interactions ===
    CacheAccess {
        cell: Option<CellId>,
        tier: &'static str,
        key_summary: String,
        hit: bool,
    },
    CacheInvalidate {
        tier: &'static str,
        sheet: SheetId,
        col: u32,
        reason: &'static str,
    },

    // === Overflow ===
    BufferOverflow {
        dropped: u64,
    },
}

// ---------------------------------------------------------------------------
// Journal entry
// ---------------------------------------------------------------------------

/// A single journal entry with a monotonic sequence number.
#[derive(Debug)]
pub struct JournalEntry {
    pub seq: u64,
    pub event: JournalEvent,
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

/// Collects journal events with optional filtering and an event cap.
pub struct JournalCollector {
    entries: Vec<JournalEntry>,
    next_seq: u64,
    cell_filter: Option<HashSet<CellId>>,
    position_filter: Option<HashSet<(SheetId, u32, u32)>>,
    max_events: usize,
    dropped: u64,
}

impl JournalCollector {
    /// Create a new collector with default settings (max 500,000 events, no filters).
    #[must_use]
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            next_seq: 0,
            cell_filter: None,
            position_filter: None,
            max_events: 500_000,
            dropped: 0,
        }
    }

    /// Set a cell-level filter. Only events referencing one of these cells will be recorded
    /// (structural/envelope events always pass).
    pub fn with_cell_filter(&mut self, cells: HashSet<CellId>) {
        self.cell_filter = Some(cells);
    }

    /// Set a position-level filter. Only Write events targeting one of these (sheet, row, col)
    /// positions will be recorded (structural/envelope events always pass).
    pub fn with_position_filter(&mut self, positions: HashSet<(SheetId, u32, u32)>) {
        self.position_filter = Some(positions);
    }

    /// Override the maximum number of events before the buffer overflows.
    /// Builder-style: returns `Self` for chaining.
    #[must_use]
    pub fn with_max_events_value(mut self, n: usize) -> Self {
        self.max_events = n;
        self
    }

    /// Record a journal event. Checks filters and the event cap.
    pub fn record(&mut self, event: JournalEvent) {
        // If we already hit overflow, just count and discard.
        if self.dropped > 0 {
            self.dropped += 1;
            return;
        }

        // Check capacity — if at max, emit one BufferOverflow and stop.
        if self.entries.len() >= self.max_events {
            self.dropped = 1;
            self.entries.push(JournalEntry {
                seq: self.next_seq,
                event: JournalEvent::BufferOverflow { dropped: 1 },
            });
            self.next_seq += 1;
            return;
        }

        // Apply filters.
        if !self.passes_filter(&event) {
            return;
        }

        self.entries.push(JournalEntry {
            seq: self.next_seq,
            event,
        });
        self.next_seq += 1;
    }

    /// Consume the collector, returning collected entries.
    #[must_use]
    pub fn take_entries(self) -> Vec<JournalEntry> {
        self.entries
    }

    /// Number of entries currently collected.
    #[must_use]
    pub fn entry_count(&self) -> usize {
        self.entries.len()
    }

    /// Number of events dropped due to buffer overflow.
    #[must_use]
    pub fn dropped_count(&self) -> u64 {
        self.dropped
    }

    // -----------------------------------------------------------------------
    // Filter logic
    // -----------------------------------------------------------------------

    /// Returns true if the event passes installed filters (or if no filters are set).
    fn passes_filter(&self, event: &JournalEvent) -> bool {
        // If no filters at all, everything passes.
        if self.cell_filter.is_none() && self.position_filter.is_none() {
            return true;
        }

        // Structural/envelope events always pass regardless of filters.
        if Self::is_envelope_event(event) {
            return true;
        }

        // Extract cell from event and check cell filter.
        if let Some(cell) = Self::extract_cell(event) {
            if let Some(ref filter) = self.cell_filter {
                if filter.contains(&cell) {
                    return true;
                }
            }
        }

        // For Write events, also check position filter.
        if let JournalEvent::Write {
            sheet,
            row,
            col,
            cell,
            ..
        } = event
        {
            if let Some(ref pos_filter) = self.position_filter {
                if pos_filter.contains(&(*sheet, *row, *col)) {
                    return true;
                }
            }
            // If cell filter is set and the write has a cell, it was already checked above.
            // If neither filter matched, fall through to false.
            let _ = cell; // suppress unused warning
        }

        // For CacheInvalidate, check position filter on (sheet, 0, col) — best effort.
        if let JournalEvent::CacheInvalidate { sheet, col, .. } = event {
            if let Some(ref pos_filter) = self.position_filter {
                // Cache invalidation is column-level; check if any position in that column matches.
                // For simplicity, we don't do a full scan — just pass if position filter is set
                // and the sheet+col matches any entry.
                for &(fs, _fr, fc) in pos_filter.iter() {
                    if fs == *sheet && fc == *col {
                        return true;
                    }
                }
            }
        }

        // If no filter matched, reject.
        false
    }

    /// Structural/envelope events that always pass filters.
    fn is_envelope_event(event: &JournalEvent) -> bool {
        matches!(
            event,
            JournalEvent::RecalcStart { .. }
                | JournalEvent::RecalcEnd { .. }
                | JournalEvent::LevelStart { .. }
                | JournalEvent::ParallelApplyStart { .. }
                | JournalEvent::BufferOverflow { .. }
                | JournalEvent::ProjectionStabilizeStart { .. }
        )
    }

    /// Extract the primary CellId from an event (if present).
    fn extract_cell(event: &JournalEvent) -> Option<CellId> {
        match event {
            JournalEvent::AggPrepassResolved { cell, .. }
            | JournalEvent::EvalStart { cell, .. }
            | JournalEvent::EvalResult { cell, .. }
            | JournalEvent::SpillHandlingStart { cell, .. }
            | JournalEvent::SpillHandlingEnd { cell, .. }
            | JournalEvent::Decision { cell, .. }
            | JournalEvent::EntryWrite { cell, .. }
            | JournalEvent::ProjectionRegister { source: cell, .. }
            | JournalEvent::ProjectionMaterializeStart { source: cell, .. }
            | JournalEvent::ProjectionMaterializeCell { source: cell, .. }
            | JournalEvent::ProjectionClear { source: cell, .. }
            | JournalEvent::ProjectionConflict { source: cell, .. } => Some(*cell),
            JournalEvent::Write { cell, .. } => *cell,
            JournalEvent::CacheAccess { cell, .. } => *cell,
            // Envelope and overflow events have no cell.
            _ => None,
        }
    }
}

impl Default for JournalCollector {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Thread-local storage
// ---------------------------------------------------------------------------

thread_local! {
    static JOURNAL: RefCell<Option<JournalCollector>> = RefCell::new(None);
}

/// Install a collector into the current thread's journal slot.
/// Any previously installed collector is dropped.
pub fn install(collector: JournalCollector) {
    JOURNAL.with(|j| {
        *j.borrow_mut() = Some(collector);
    });
}

/// Take the current thread's collector (if installed), leaving the slot empty.
pub fn take() -> Option<JournalCollector> {
    JOURNAL.with(|j| j.borrow_mut().take())
}

/// Record an event to the thread-local collector (if installed).
pub fn record(event: JournalEvent) {
    JOURNAL.with(|j| {
        if let Some(ref mut collector) = *j.borrow_mut() {
            collector.record(event);
        }
    });
}

// ---------------------------------------------------------------------------
// Value formatting helper
// ---------------------------------------------------------------------------

/// Format a `CellValue` as a human-readable summary string for journal entries.
pub fn journal_fmt_value(v: &CellValue) -> String {
    match v {
        CellValue::Number(n) => {
            let f = n.get();
            // Format cleanly: no trailing `.0` for integers.
            if f == f.trunc() && f.abs() < 1e15 {
                format!("{}", f as i64)
            } else {
                format!("{}", f)
            }
        }
        CellValue::Text(s) => format!("\"{}\"", s),
        CellValue::Boolean(b) => {
            if *b {
                "TRUE".to_string()
            } else {
                "FALSE".to_string()
            }
        }
        CellValue::Error(e, _) => format!("{}", e),
        CellValue::Null => "null".to_string(),
        CellValue::Image(image) => format!("image({})", image.fallback_text()),
        CellValue::Array(arr) => {
            let rows = arr.rows();
            let cols = arr.cols();
            let total = rows * cols;
            let mut preview = Vec::new();
            for i in 0..std::cmp::min(3, total) {
                let r = i / cols;
                let c = i % cols;
                if let Some(v) = arr.get(r, c) {
                    preview.push(journal_fmt_value(v));
                }
            }
            let suffix = if total > 3 { ", ..." } else { "" };
            format!("Array({}x{})[{}{}]", rows, cols, preview.join(", "), suffix)
        }
    }
}

// ---------------------------------------------------------------------------
// Macros (compile to nothing when feature is disabled)
// ---------------------------------------------------------------------------

/// Record an arbitrary `JournalEvent` to the thread-local collector.
///
/// Compiles to nothing when the `journal` feature is disabled.
#[macro_export]
macro_rules! journal_event {
    ($event:expr) => {
        #[cfg(feature = "journal")]
        {
            $crate::journal::record($event);
        }
    };
}

/// Record a cell-value write event with automatic formatting.
///
/// Compiles to nothing when the `journal` feature is disabled.
#[macro_export]
macro_rules! journal_write {
    ($sheet:expr, $row:expr, $col:expr, $old:expr, $new:expr, $source:expr, $cell:expr) => {
        #[cfg(feature = "journal")]
        {
            $crate::journal::record($crate::journal::JournalEvent::Write {
                sheet: $sheet,
                row: $row,
                col: $col,
                old_value: $crate::journal::journal_fmt_value($old),
                new_value: $crate::journal::journal_fmt_value($new),
                source: $source,
                cell: $cell,
            });
        }
    };
}

/// Record a decision-point event.
///
/// Compiles to nothing when the `journal` feature is disabled.
#[macro_export]
macro_rules! journal_decision {
    ($cell:expr, $point:expr, $condition:expr, $path:expr) => {
        #[cfg(feature = "journal")]
        {
            $crate::journal::record($crate::journal::JournalEvent::Decision {
                cell: $cell,
                point: $point,
                condition: $condition,
                path: $path,
            });
        }
    };
}

/// Record a cache access event.
///
/// Compiles to nothing when the `journal` feature is disabled.
#[macro_export]
macro_rules! journal_cache {
    ($cell:expr, $tier:expr, $key:expr, $hit:expr) => {
        #[cfg(feature = "journal")]
        {
            $crate::journal::record($crate::journal::JournalEvent::CacheAccess {
                cell: $cell,
                tier: $tier,
                key_summary: $key,
                hit: $hit,
            });
        }
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collector_records_and_returns_events() {
        let mut collector = JournalCollector::new();
        collector.record(JournalEvent::RecalcStart {
            mode: "full",
            total_formula_cells: 10,
        });
        collector.record(JournalEvent::LevelStart {
            level_index: 0,
            total_levels: 1,
            cell_count: 2,
            parallel: false,
        });
        collector.record(JournalEvent::RecalcEnd {
            changed_count: 5,
            projection_delta_count: 0,
        });
        assert_eq!(collector.entry_count(), 3);
        let entries = collector.take_entries();
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].seq, 0);
        assert_eq!(entries[1].seq, 1);
        assert_eq!(entries[2].seq, 2);
    }

    #[test]
    fn cell_filter_passes_matching_cells() {
        let cell_a = CellId::from_raw(100);
        let cell_b = CellId::from_raw(200);
        let mut filter = HashSet::new();
        filter.insert(cell_a);

        let mut collector = JournalCollector::new();
        collector.with_cell_filter(filter);
        // RecalcStart always passes (envelope event)
        collector.record(JournalEvent::RecalcStart {
            mode: "full",
            total_formula_cells: 10,
        });
        // EvalStart for cell_a should pass
        collector.record(JournalEvent::EvalStart {
            cell: cell_a,
            sheet: "Sheet1".into(),
            row: 0,
            col: 0,
            formula: "=1+1".into(),
        });
        // EvalStart for cell_b should NOT pass
        collector.record(JournalEvent::EvalStart {
            cell: cell_b,
            sheet: "Sheet1".into(),
            row: 1,
            col: 0,
            formula: "=2+2".into(),
        });
        assert_eq!(collector.entry_count(), 2); // RecalcStart + cell_a EvalStart
    }

    #[test]
    fn position_filter_passes_matching_writes() {
        let sheet = SheetId::from_raw(1);
        let mut positions = HashSet::new();
        positions.insert((sheet, 5, 3));

        let mut collector = JournalCollector::new();
        collector.with_position_filter(positions);
        // Write to (5,3) should pass
        collector.record(JournalEvent::Write {
            sheet,
            row: 5,
            col: 3,
            old_value: "null".into(),
            new_value: "42".into(),
            source: "test",
            cell: None,
        });
        // Write to (6,3) should NOT pass (no cell filter match either)
        collector.record(JournalEvent::Write {
            sheet,
            row: 6,
            col: 3,
            old_value: "null".into(),
            new_value: "99".into(),
            source: "test",
            cell: None,
        });
        assert_eq!(collector.entry_count(), 1);
    }

    #[test]
    fn buffer_overflow_stops_recording() {
        let mut collector = JournalCollector::new().with_max_events_value(5);
        for i in 0..10 {
            collector.record(JournalEvent::RecalcStart {
                mode: "full",
                total_formula_cells: i,
            });
        }
        // 5 events recorded, then 1 BufferOverflow entry, then truly stopped.
        let entries = collector.take_entries();
        assert_eq!(entries.len(), 6); // 5 + 1 overflow marker
        // Last entry should be BufferOverflow
        match &entries[5].event {
            JournalEvent::BufferOverflow { dropped } => {
                assert_eq!(*dropped, 1);
            }
            other => panic!("Expected BufferOverflow, got {:?}", other),
        }
    }

    #[test]
    fn buffer_overflow_counts_dropped() {
        let mut collector = JournalCollector::new().with_max_events_value(3);
        for i in 0..10 {
            collector.record(JournalEvent::RecalcStart {
                mode: "full",
                total_formula_cells: i,
            });
        }
        // 3 events, then overflow marker (seq=3), then 6 more dropped.
        assert_eq!(collector.dropped_count(), 7); // 1 initial + 6 subsequent
    }

    #[test]
    fn thread_local_install_take() {
        let collector = JournalCollector::new();
        install(collector);
        record(JournalEvent::RecalcStart {
            mode: "full",
            total_formula_cells: 1,
        });
        let taken = take().unwrap();
        assert_eq!(taken.entry_count(), 1);
        // After take, no collector installed
        assert!(take().is_none());
    }

    #[test]
    fn fmt_value_formats_correctly() {
        assert_eq!(journal_fmt_value(&CellValue::number(42.0)), "42");
        assert_eq!(
            journal_fmt_value(&CellValue::Text("hello".into())),
            "\"hello\""
        );
        assert_eq!(journal_fmt_value(&CellValue::Boolean(true)), "TRUE");
        assert_eq!(journal_fmt_value(&CellValue::Null), "null");
    }

    #[test]
    fn fmt_value_formats_number_with_decimals() {
        assert_eq!(journal_fmt_value(&CellValue::number(3.14)), "3.14");
    }

    #[test]
    fn fmt_value_formats_error() {
        use value_types::CellError;
        let val = CellValue::Error(CellError::Na, None);
        let formatted = journal_fmt_value(&val);
        // CellError::Na displays as "#N/A"
        assert!(formatted.contains("N/A"), "got: {}", formatted);
    }

    #[test]
    fn no_filters_passes_everything() {
        let mut collector = JournalCollector::new();
        let cell = CellId::from_raw(1);
        collector.record(JournalEvent::EvalStart {
            cell,
            sheet: "Sheet1".into(),
            row: 0,
            col: 0,
            formula: "=1".into(),
        });
        collector.record(JournalEvent::Write {
            sheet: SheetId::from_raw(1),
            row: 0,
            col: 0,
            old_value: "null".into(),
            new_value: "1".into(),
            source: "test",
            cell: None,
        });
        assert_eq!(collector.entry_count(), 2);
    }

    #[test]
    fn record_without_collector_is_noop() {
        // Ensure no collector is installed (clean state)
        let _ = take();
        // This should not panic — just a no-op.
        record(JournalEvent::RecalcStart {
            mode: "full",
            total_formula_cells: 0,
        });
    }

    #[test]
    fn default_max_events() {
        let collector = JournalCollector::new();
        // Just verify it doesn't panic and has a sensible default.
        assert_eq!(collector.entry_count(), 0);
        assert_eq!(collector.dropped_count(), 0);
    }
}
