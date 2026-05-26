//! Table Events — Event types for table lifecycle changes.
//!
//! Ported from `spreadsheet-model/src/tables/events.ts`.
//!
//! The TypeScript version used Y.js observers and EventBus for real-time
//! change detection. In the Rust compute-core, we define the event types
//! as pure data structures. The storage/bridge layer is responsible for
//! detecting changes and emitting these events.
//!
//! Every type is PURE data. No I/O, no observers.

use serde::{Deserialize, Serialize};

use super::types::TableRange;

// ============================================================================
// Event Source
// ============================================================================

/// Source of a structural change.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StructureChangeSource {
    /// User action via UI.
    #[default]
    User,
    /// File import.
    Import,
    /// Programmatic API call.
    Api,
    /// Remote collaboration change.
    Remote,
}

// ============================================================================
// Table Events
// ============================================================================

/// A table lifecycle event.
///
/// The storage/bridge layer detects changes and constructs these events.
/// Consumer code can pattern-match on the variant.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum TableEvent {
    /// A new table was created.
    #[serde(rename = "table:created")]
    Created(TableCreatedEvent),
    /// A table was deleted.
    #[serde(rename = "table:deleted")]
    Deleted(TableDeletedEvent),
    /// A table was resized (range changed).
    #[serde(rename = "table:resized")]
    Resized(TableResizedEvent),
    /// A table was renamed.
    #[serde(rename = "table:renamed")]
    Renamed(TableRenamedEvent),
    /// A table's total row was toggled.
    #[serde(rename = "table:totalRowChanged")]
    TotalRowChanged(TableTotalRowChangedEvent),
    /// A table column was renamed.
    #[serde(rename = "table:columnRenamed")]
    ColumnRenamed(TableColumnRenamedEvent),
    /// General table update (catch-all for other changes).
    #[serde(rename = "table:updated")]
    Updated(TableUpdatedEvent),
}

/// Event: table created.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableCreatedEvent {
    pub timestamp: f64,
    pub sheet_id: String,
    pub table_id: String,
    pub source: StructureChangeSource,
}

/// Event: table deleted.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDeletedEvent {
    pub timestamp: f64,
    pub sheet_id: String,
    pub table_id: String,
    pub source: StructureChangeSource,
}

/// Event: table resized.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableResizedEvent {
    pub timestamp: f64,
    pub sheet_id: String,
    pub table_id: String,
    pub old_range: TableRange,
    pub new_range: TableRange,
    pub source: StructureChangeSource,
}

/// Event: table renamed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableRenamedEvent {
    pub timestamp: f64,
    pub sheet_id: String,
    pub table_id: String,
    pub old_name: String,
    pub new_name: String,
    pub source: StructureChangeSource,
}

/// Event: total row toggled.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableTotalRowChangedEvent {
    pub timestamp: f64,
    pub sheet_id: String,
    pub table_id: String,
    pub has_total_row: bool,
    pub source: StructureChangeSource,
}

/// Event: column renamed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableColumnRenamedEvent {
    pub timestamp: f64,
    pub sheet_id: String,
    pub table_id: String,
    pub column_id: String,
    pub old_name: String,
    pub new_name: String,
    pub source: StructureChangeSource,
}

/// Event: general table update.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableUpdatedEvent {
    pub timestamp: f64,
    pub sheet_id: String,
    pub table_id: String,
    pub source: StructureChangeSource,
}

// ============================================================================
// Diff Helpers
// ============================================================================

/// Compare two table states and produce a list of events describing the changes.
///
/// This is a pure diff function: given old and new table state, it returns
/// the events that describe the difference. The caller is responsible for
/// providing the timestamp and source.
pub fn diff_table_events(
    old: &super::types::Table,
    new: &super::types::Table,
    timestamp: f64,
    source: StructureChangeSource,
) -> Vec<TableEvent> {
    let mut events = Vec::new();

    // Check resize
    if old.range != new.range {
        events.push(TableEvent::Resized(TableResizedEvent {
            timestamp,
            sheet_id: new.sheet_id.clone(),
            table_id: new.id.clone(),
            old_range: old.range,
            new_range: new.range,
            source,
        }));
    }

    // Check rename
    if old.name != new.name {
        events.push(TableEvent::Renamed(TableRenamedEvent {
            timestamp,
            sheet_id: new.sheet_id.clone(),
            table_id: new.id.clone(),
            old_name: old.name.clone(),
            new_name: new.name.clone(),
            source,
        }));
    }

    // Check total row toggle
    if old.has_totals_row != new.has_totals_row {
        events.push(TableEvent::TotalRowChanged(TableTotalRowChangedEvent {
            timestamp,
            sheet_id: new.sheet_id.clone(),
            table_id: new.id.clone(),
            has_total_row: new.has_totals_row,
            source,
        }));
    }

    // Check column renames
    let min_cols = old.columns.len().min(new.columns.len());
    for i in 0..min_cols {
        if old.columns[i].name != new.columns[i].name {
            events.push(TableEvent::ColumnRenamed(TableColumnRenamedEvent {
                timestamp,
                sheet_id: new.sheet_id.clone(),
                table_id: new.id.clone(),
                column_id: new.columns[i].id.clone(),
                old_name: old.columns[i].name.clone(),
                new_name: new.columns[i].name.clone(),
                source,
            }));
        }
    }

    // General update event if anything changed
    if old != new {
        events.push(TableEvent::Updated(TableUpdatedEvent {
            timestamp,
            sheet_id: new.sheet_id.clone(),
            table_id: new.id.clone(),
            source,
        }));
    }

    events
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::super::table::create_table;
    use super::super::types::TableRange;
    use super::*;

    fn make_table(name: &str) -> super::super::types::Table {
        create_table(
            name,
            "sheet1",
            TableRange::new(0, 0, 10, 2),
            &["A", "B", "C"],
            None,
        )
        .unwrap()
    }

    #[test]
    fn no_changes_no_events() {
        let t = make_table("T1");
        let events = diff_table_events(&t, &t, 1000.0, StructureChangeSource::User);
        assert!(events.is_empty());
    }

    #[test]
    fn detects_resize() {
        let old = make_table("T1");
        let mut new = old.clone();
        new.range = TableRange::new(
            new.range.start_row(),
            new.range.start_col(),
            15,
            new.range.end_col(),
        );
        let events = diff_table_events(&old, &new, 1000.0, StructureChangeSource::User);
        assert!(events.iter().any(|e| matches!(e, TableEvent::Resized(_))));
        if let TableEvent::Resized(ref e) = events[0] {
            assert_eq!(e.old_range.end_row(), 10);
            assert_eq!(e.new_range.end_row(), 15);
        }
    }

    #[test]
    fn detects_rename() {
        let old = make_table("T1");
        let mut new = old.clone();
        new.name = "Renamed".to_string();
        let events = diff_table_events(&old, &new, 1000.0, StructureChangeSource::User);
        assert!(events.iter().any(|e| matches!(e, TableEvent::Renamed(_))));
        if let Some(TableEvent::Renamed(e)) =
            events.iter().find(|e| matches!(e, TableEvent::Renamed(_)))
        {
            assert_eq!(e.old_name, "T1");
            assert_eq!(e.new_name, "Renamed");
        }
    }

    #[test]
    fn detects_total_row_toggle() {
        let old = make_table("T1");
        let mut new = old.clone();
        new.has_totals_row = true;
        let events = diff_table_events(&old, &new, 1000.0, StructureChangeSource::User);
        assert!(
            events
                .iter()
                .any(|e| matches!(e, TableEvent::TotalRowChanged(_)))
        );
    }

    #[test]
    fn detects_column_rename() {
        let old = make_table("T1");
        let mut new = old.clone();
        new.columns[1].name = "NewB".to_string();
        let events = diff_table_events(&old, &new, 1000.0, StructureChangeSource::User);
        assert!(
            events
                .iter()
                .any(|e| matches!(e, TableEvent::ColumnRenamed(_)))
        );
        if let Some(TableEvent::ColumnRenamed(e)) = events
            .iter()
            .find(|e| matches!(e, TableEvent::ColumnRenamed(_)))
        {
            assert_eq!(e.old_name, "B");
            assert_eq!(e.new_name, "NewB");
        }
    }

    #[test]
    fn any_change_emits_updated() {
        let old = make_table("T1");
        let mut new = old.clone();
        new.banded_rows = false;
        let events = diff_table_events(&old, &new, 1000.0, StructureChangeSource::Api);
        assert!(events.iter().any(|e| matches!(e, TableEvent::Updated(_))));
    }

    #[test]
    fn source_preserved() {
        let old = make_table("T1");
        let mut new = old.clone();
        new.name = "X".to_string();
        let events = diff_table_events(&old, &new, 1000.0, StructureChangeSource::Import);
        if let Some(TableEvent::Renamed(e)) =
            events.iter().find(|e| matches!(e, TableEvent::Renamed(_)))
        {
            assert_eq!(e.source, StructureChangeSource::Import);
        }
    }

    #[test]
    fn event_serde_round_trip() {
        let event = TableEvent::Created(TableCreatedEvent {
            timestamp: 1234.0,
            sheet_id: "s1".to_string(),
            table_id: "t1".to_string(),
            source: StructureChangeSource::User,
        });
        let json = serde_json::to_string(&event).unwrap();
        let back: TableEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(event, back);
    }
}
