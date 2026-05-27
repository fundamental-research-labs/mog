use yrs::TransactionMut;
use yrs::types::{Event, Events, PathSegment};

use cell_types::SheetId;

use crate::schema::{
    KEY_NAMED_RANGES, KEY_RANGE_BINDINGS, KEY_SHEET_ORDER, KEY_TABLES, KEY_WORKBOOK_SETTINGS,
};

use super::changes::*;
use super::helpers::entry_change_kind;

pub(super) fn observe_workbook_events(
    buffer: &mut DocumentChanges,
    txn: &TransactionMut,
    events: &Events,
) {
    for event in events.iter() {
        if let Event::Map(map_event) = event {
            let path = map_event.path();

            if path.is_empty() {
                // Top-level workbook map changed — entries added/removed.
                // Most sub-map *content* changes fire below at path.len() >= 1.
                // BUT: when an entire sub-map is added or removed at the
                // workbook root (e.g. lazy-create of `tables` on first
                // write, or undo unwinding that lazy-create), yrs only
                // emits the workbook-root event — the inner map's
                // contents disappear without their own events.
                //
                // Fix: detect known sub-map keys here and emit a synthetic
                // "domain changed" entry so the engine's mirror-sync
                // pipeline (`sync_tables_from_yrs`,
                // `sync_named_ranges_from_yrs`) re-reads yrs and
                // reconciles the mirror. Without this, an undo that
                // removes the lazy-created sub-map leaves the mirror
                // holding stale data.
                let keys = map_event.keys(txn);
                for (key, change) in keys {
                    let kind = entry_change_kind(change);
                    match key.as_ref() {
                        k if k == KEY_TABLES => {
                            // Domain reset: the *content* of the tables sub-map is
                            // being created/destroyed wholesale. Push a sentinel
                            // entry; sync_tables_from_yrs is idempotent and will
                            // re-read yrs and reconcile the mirror.
                            buffer.tables.push(TableCellChange {
                                key: String::new(),
                                kind,
                            });
                        }
                        k if k == KEY_RANGE_BINDINGS => {
                            buffer.tables.push(TableCellChange {
                                key: String::new(),
                                kind,
                            });
                        }
                        k if k == KEY_NAMED_RANGES => {
                            buffer.named_ranges.push(SheetLevelChange {
                                sheet_id: SheetId::from_raw(0),
                                key: None,
                                kind,
                            });
                        }
                        k if k == KEY_WORKBOOK_SETTINGS => {
                            buffer.workbook_settings_changed = true;
                        }
                        _ => {
                            // Other workbook sub-maps (slicers, etc.)
                            // don't currently have a mirror-sync pipeline keyed on
                            // observer changes. They're either read on-demand from
                            // yrs or driven by direct mutation paths.
                        }
                    }
                }
                continue;
            }

            // Path: [Key(sub_map_key), ...]
            let sub_map_key = match path.front() {
                Some(PathSegment::Key(k)) => k.clone(),
                _ => continue,
            };

            match sub_map_key.as_ref() {
                // --- tables ---
                k if k == KEY_TABLES => {
                    if path.len() == 1 {
                        // Entries added/removed from the tables map.
                        let keys = map_event.keys(txn);
                        for (key, change) in keys {
                            buffer.tables.push(TableCellChange {
                                key: key.to_string(),
                                kind: entry_change_kind(change),
                            });
                        }
                    } else if path.len() == 2 {
                        // A table's internal map was modified in place.
                        if let Some(PathSegment::Key(k)) = path.get(1) {
                            buffer.tables.push(TableCellChange {
                                key: k.to_string(),
                                kind: CellChangeKind::Modified,
                            });
                        }
                    }
                }

                // --- rangeBindings ---
                k if k == KEY_RANGE_BINDINGS => {
                    if path.len() == 1 {
                        let keys = map_event.keys(txn);
                        for (key, change) in keys {
                            if key.as_ref().starts_with("table:") {
                                buffer.tables.push(TableCellChange {
                                    key: key.to_string(),
                                    kind: entry_change_kind(change),
                                });
                            }
                        }
                    }
                }

                // --- namedRanges ---
                k if k == KEY_NAMED_RANGES => {
                    if path.len() == 1 {
                        let keys = map_event.keys(txn);
                        for (key, change) in keys {
                            buffer.named_ranges.push(SheetLevelChange {
                                // Named ranges are workbook-level; use a zero sheet_id.
                                sheet_id: SheetId::from_raw(0),
                                key: Some(key.to_string()),
                                kind: entry_change_kind(change),
                            });
                        }
                    } else if path.len() == 2 {
                        let field = match path.get(1) {
                            Some(PathSegment::Key(k)) => Some(k.to_string()),
                            _ => None,
                        };
                        buffer.named_ranges.push(SheetLevelChange {
                            sheet_id: SheetId::from_raw(0),
                            key: field,
                            kind: CellChangeKind::Modified,
                        });
                    }
                }

                // --- workbookSettings ---
                k if k == KEY_WORKBOOK_SETTINGS => {
                    buffer.workbook_settings_changed = true;
                }

                // --- Unknown workbook sub-maps ---
                _ => {}
            }
        } else if let Event::Array(arr_event) = event {
            // The `sheetOrder` Y.Array is nested inside the workbook
            // map. Mutations to it (move_sheet, reorder_sheets, and
            // their undo/redo) emit `Event::Array` events. The path
            // contains a single `Key("sheetOrder")` segment.
            let path = arr_event.path();
            if path.len() == 1
                && matches!(
                    path.front(),
                    Some(PathSegment::Key(k)) if k.as_ref() == KEY_SHEET_ORDER
                )
            {
                buffer.sheet_order_changed = true;
            }
        }
    }
}
