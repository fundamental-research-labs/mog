use yrs::types::{EntryChange, Event, Events, PathSegment};
use yrs::{Any, Map, Out, ReadTxn, TransactionMut};

use cell_types::SheetId;

use crate::schema::{
    KEY_NAMED_RANGES, KEY_SHEET_ORDER, KEY_SLICERS, KEY_TABLES, KEY_WORKBOOK_SETTINGS,
};

use super::changes::*;
use super::helpers::entry_change_kind;

fn parse_table_sheet_id(sheet_id: &str) -> Option<SheetId> {
    SheetId::from_uuid_str(sheet_id).ok()
}

fn string_from_scalar_out(out: &Out) -> Option<String> {
    match out {
        Out::Any(Any::String(value)) => Some(value.to_string()),
        _ => None,
    }
}

fn string_from_scalar_change(change: &EntryChange) -> Option<String> {
    match change {
        EntryChange::Inserted(new) => string_from_scalar_out(new),
        EntryChange::Updated(old, new) => {
            string_from_scalar_out(new).or_else(|| string_from_scalar_out(old))
        }
        EntryChange::Removed(old) => string_from_scalar_out(old),
    }
}

fn sheet_id_from_table_out<T: ReadTxn>(out: &Out, txn: &T) -> Option<SheetId> {
    match out {
        Out::YMap(map) => {
            let value = map.get(txn, domain_types::yrs_schema::table::KEY_SHEET_ID)?;
            match value {
                Out::Any(Any::String(sheet_id)) => parse_table_sheet_id(sheet_id.as_ref()),
                _ => None,
            }
        }
        _ => None,
    }
}

fn name_from_table_out<T: ReadTxn>(out: &Out, txn: &T) -> Option<String> {
    match out {
        Out::YMap(map) => {
            let value = map.get(txn, domain_types::yrs_schema::table::KEY_NAME)?;
            match value {
                Out::Any(Any::String(name)) => Some(name.to_string()),
                _ => None,
            }
        }
        _ => None,
    }
}

fn sheet_id_from_table_change<T: ReadTxn>(change: &EntryChange, txn: &T) -> Option<SheetId> {
    match change {
        EntryChange::Inserted(new) => sheet_id_from_table_out(new, txn),
        EntryChange::Updated(old, new) => {
            sheet_id_from_table_out(new, txn).or_else(|| sheet_id_from_table_out(old, txn))
        }
        EntryChange::Removed(old) => sheet_id_from_table_out(old, txn),
    }
}

fn name_from_table_change<T: ReadTxn>(change: &EntryChange, txn: &T) -> Option<String> {
    match change {
        EntryChange::Inserted(new) => name_from_table_out(new, txn),
        EntryChange::Updated(old, new) => {
            name_from_table_out(new, txn).or_else(|| name_from_table_out(old, txn))
        }
        EntryChange::Removed(old) => name_from_table_out(old, txn),
    }
}

#[derive(Clone)]
struct TableSubmapEntry {
    key: String,
    name: Option<String>,
    sheet_id: Option<SheetId>,
}

fn table_submap_entries<T: ReadTxn>(out: &Out, txn: &T) -> Vec<TableSubmapEntry> {
    let Out::YMap(map) = out else {
        return Vec::new();
    };

    map.iter(txn)
        .map(|(key, value)| {
            let key = key.to_string();
            TableSubmapEntry {
                key,
                name: name_from_table_out(&value, txn),
                sheet_id: sheet_id_from_table_out(&value, txn),
            }
        })
        .collect()
}

fn push_table_submap_changes<T: ReadTxn>(
    buffer: &mut DocumentChanges,
    change: &EntryChange,
    txn: &T,
) -> bool {
    let before_len = buffer.tables.len();
    match change {
        EntryChange::Inserted(new) => {
            for entry in table_submap_entries(new, txn) {
                buffer.tables.push(TableCellChange {
                    key: entry.key,
                    name: entry.name,
                    sheet_id: entry.sheet_id,
                    kind: CellChangeKind::Modified,
                });
            }
        }
        EntryChange::Removed(old) => {
            for entry in table_submap_entries(old, txn) {
                buffer.tables.push(TableCellChange {
                    key: entry.key,
                    name: entry.name,
                    sheet_id: entry.sheet_id,
                    kind: CellChangeKind::Removed,
                });
            }
        }
        EntryChange::Updated(old, new) => {
            let old_entries = table_submap_entries(old, txn);
            let new_entries = table_submap_entries(new, txn);

            for entry in &new_entries {
                buffer.tables.push(TableCellChange {
                    key: entry.key.clone(),
                    name: entry.name.clone(),
                    sheet_id: entry.sheet_id,
                    kind: CellChangeKind::Modified,
                });
            }
            for entry in old_entries {
                if new_entries
                    .iter()
                    .any(|new_entry| new_entry.key == entry.key)
                {
                    continue;
                }
                buffer.tables.push(TableCellChange {
                    key: entry.key,
                    name: entry.name,
                    sheet_id: entry.sheet_id,
                    kind: CellChangeKind::Removed,
                });
            }
        }
    }
    buffer.tables.len() > before_len
}

fn parse_slicer_sheet_id(sheet_id: &str) -> Option<SheetId> {
    SheetId::from_uuid_str(sheet_id).ok()
}

fn slicer_from_out<T: ReadTxn>(
    out: &Out,
    txn: &T,
) -> Option<domain_types::domain::slicer::StoredSlicer> {
    match out {
        Out::YMap(map) => domain_types::yrs_schema::slicer::from_yrs_map(map, txn),
        _ => None,
    }
}

fn sheet_id_from_slicer(slicer: &domain_types::domain::slicer::StoredSlicer) -> Option<SheetId> {
    parse_slicer_sheet_id(&slicer.sheet_id)
}

fn slicer_change_from_entry<T: ReadTxn>(
    slicer_id: &str,
    change: &EntryChange,
    txn: &T,
) -> SlicerCellChange {
    let data = match change {
        EntryChange::Inserted(new) => slicer_from_out(new, txn),
        EntryChange::Updated(old, new) => {
            slicer_from_out(new, txn).or_else(|| slicer_from_out(old, txn))
        }
        EntryChange::Removed(old) => slicer_from_out(old, txn),
    };
    SlicerCellChange {
        slicer_id: slicer_id.to_string(),
        sheet_id: data.as_ref().and_then(sheet_id_from_slicer),
        kind: entry_change_kind(change),
        data,
    }
}

fn push_slicer_submap_changes<T: ReadTxn>(
    buffer: &mut DocumentChanges,
    change: &EntryChange,
    txn: &T,
) {
    let out = match change {
        EntryChange::Inserted(new) => new,
        EntryChange::Updated(_, new) => new,
        EntryChange::Removed(old) => old,
    };
    if let Out::YMap(map) = out {
        for (slicer_id, value) in map.iter(txn) {
            let data = slicer_from_out(&value, txn);
            buffer.slicers.push(SlicerCellChange {
                slicer_id: slicer_id.to_string(),
                sheet_id: data.as_ref().and_then(sheet_id_from_slicer),
                kind: entry_change_kind(change),
                data,
            });
        }
    }
}

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
                            if !push_table_submap_changes(buffer, change, txn) {
                                buffer.tables.push(TableCellChange {
                                    key: String::new(),
                                    name: None,
                                    sheet_id: None,
                                    kind,
                                });
                            }
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
                        k if k == KEY_SLICERS => {
                            push_slicer_submap_changes(buffer, change, txn);
                        }
                        _ => {
                            // Other workbook sub-maps are either read on-demand
                            // from yrs or driven by direct mutation paths.
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
                                name: name_from_table_change(change, txn),
                                sheet_id: sheet_id_from_table_change(change, txn),
                                kind: entry_change_kind(change),
                            });
                        }
                    } else if path.len() == 2 {
                        // A table's internal map was modified in place.
                        if let Some(PathSegment::Key(k)) = path.get(1) {
                            let mut name = None;
                            let mut sheet_id = None;
                            let keys = map_event.keys(txn);
                            for (field, change) in keys {
                                match field.as_ref() {
                                    domain_types::yrs_schema::table::KEY_NAME => {
                                        name = string_from_scalar_change(change);
                                    }
                                    domain_types::yrs_schema::table::KEY_SHEET_ID => {
                                        sheet_id = string_from_scalar_change(change)
                                            .as_deref()
                                            .and_then(parse_table_sheet_id);
                                    }
                                    _ => {}
                                }
                            }
                            buffer.tables.push(TableCellChange {
                                key: k.to_string(),
                                name,
                                sheet_id,
                                kind: CellChangeKind::Modified,
                            });
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

                // --- slicers ---
                k if k == KEY_SLICERS => {
                    if path.len() == 1 {
                        let keys = map_event.keys(txn);
                        for (key, change) in keys {
                            buffer
                                .slicers
                                .push(slicer_change_from_entry(key, change, txn));
                        }
                    } else if path.len() == 2
                        && let Some(PathSegment::Key(k)) = path.get(1)
                    {
                        buffer.slicers.push(SlicerCellChange {
                            slicer_id: k.to_string(),
                            sheet_id: None,
                            kind: CellChangeKind::Modified,
                            data: None,
                        });
                    }
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
