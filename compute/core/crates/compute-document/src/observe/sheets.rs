use std::collections::VecDeque;

use yrs::types::{Change, EntryChange, Event, Events, PathSegment};
use yrs::{Any, Array, Out, TransactionMut};

use cell_types::SheetId;

use crate::hex::{parse_cell_id, parse_sheet_id};
use crate::schema::{
    KEY_CELL_PROPERTIES, KEY_CELLS, KEY_COL_FORMATS, KEY_COL_WIDTHS, KEY_COMMENTS,
    KEY_CONDITIONAL_FORMAT, KEY_FILTER_METADATA_BINDINGS, KEY_FILTERS, KEY_FLOATING_OBJECTS,
    KEY_GROUPING, KEY_HIDDEN_COLS, KEY_HIDDEN_ROWS, KEY_MERGES, KEY_PIVOT_TABLES, KEY_PROPERTIES,
    KEY_ROW_FORMATS, KEY_ROW_HEIGHTS, KEY_SORTING, KEY_SPARKLINES,
};

use super::changes::*;
use super::helpers::{
    any_to_cell_value, entry_change_kind, extract_old_value_from_entry, extract_sheet_id,
};

fn comment_cell_ref_from_out(out: &Out, txn: &TransactionMut) -> Option<String> {
    match out {
        Out::YMap(map) => domain_types::yrs_schema::comment::from_yrs_map(map, txn)
            .map(|comment| comment.cell_ref),
        _ => None,
    }
}

fn comment_cell_ref_from_change(change: &EntryChange, txn: &TransactionMut) -> Option<String> {
    match change {
        EntryChange::Inserted(new) => comment_cell_ref_from_out(new, txn),
        EntryChange::Updated(old, new) => {
            comment_cell_ref_from_out(new, txn).or_else(|| comment_cell_ref_from_out(old, txn))
        }
        EntryChange::Removed(old) => comment_cell_ref_from_out(old, txn),
    }
}

fn axis_order_axis(sub_key: &str) -> Option<AxisOrderAxis> {
    match sub_key {
        "rowOrder" => Some(AxisOrderAxis::Row),
        "colOrder" => Some(AxisOrderAxis::Col),
        _ => None,
    }
}

fn axis_order_change_kind(delta: &[Change], current_len: u32) -> AxisOrderChangeKind {
    let mut index = 0_u32;
    let mut observed_change: Option<AxisOrderChangeKind> = None;

    for change in delta {
        match change {
            Change::Retain(count) => {
                index = index.saturating_add(*count);
            }
            Change::Added(values) => {
                if observed_change.is_some() {
                    return AxisOrderChangeKind::Structural;
                }
                let inserted_count = match u32::try_from(values.len()) {
                    Ok(count) => count,
                    Err(_) => return AxisOrderChangeKind::Structural,
                };
                if index.saturating_add(inserted_count) != current_len {
                    return AxisOrderChangeKind::Structural;
                }
                let mut ids = Vec::with_capacity(values.len());
                for value in values {
                    let Out::Any(Any::String(id)) = value else {
                        return AxisOrderChangeKind::Structural;
                    };
                    ids.push(id.to_string());
                }
                observed_change = Some(AxisOrderChangeKind::TailInserted { start: index, ids });
                index = index.saturating_add(inserted_count);
            }
            Change::Removed(count) => {
                if observed_change.is_some() || index != current_len {
                    return AxisOrderChangeKind::Structural;
                }
                observed_change = Some(AxisOrderChangeKind::TailRemoved {
                    start: index,
                    count: *count,
                });
            }
        }
    }

    observed_change.unwrap_or(AxisOrderChangeKind::Structural)
}

fn push_axis_order_change(
    buffer: &mut DocumentChanges,
    sheet_id: SheetId,
    axis: AxisOrderAxis,
    kind: AxisOrderChangeKind,
    origin: Option<Vec<u8>>,
) {
    if matches!(kind, AxisOrderChangeKind::Structural) {
        buffer.structural_changes.push(sheet_id);
    }
    buffer.axis_order.push(AxisOrderChange {
        sheet_id,
        axis,
        kind,
        origin,
    });
}

pub(super) fn observe_sheets_events(
    buffer: &mut DocumentChanges,
    txn: &TransactionMut,
    events: &Events,
) {
    for event in events.iter() {
        match event {
            Event::Map(map_event) => {
                let path = map_event.path();

                // path.len() == 0: top-level sheets map changed —
                // a sheet was added or removed.
                if path.is_empty() {
                    let keys = map_event.keys(txn);
                    for (key, change) in keys {
                        if let Some(sheet_id) = parse_sheet_id(key) {
                            match change {
                                EntryChange::Inserted(_) => {
                                    buffer.sheet_additions.push(sheet_id);
                                }
                                EntryChange::Removed(_) => {
                                    buffer.sheet_deletions.push(sheet_id);
                                }
                                EntryChange::Updated(_, _) => {
                                    // Treat update as an addition (re-sync).
                                    buffer.sheet_additions.push(sheet_id);
                                }
                            }
                        }
                    }
                    continue;
                }

                // path.len() == 1: sheet-level sub-map keys, not actionable.
                if path.len() < 2 {
                    continue;
                }

                let sheet_id = match extract_sheet_id(&path) {
                    Some(id) => id,
                    None => continue,
                };

                // Determine which sub-map this event is for.
                let sub_map_key = match path.get(1) {
                    Some(PathSegment::Key(k)) => k.clone(),
                    _ => continue,
                };

                match sub_map_key.as_ref() {
                    // --- cells ---
                    k if k == KEY_CELLS => {
                        if path.len() == 2 {
                            // Entries added/removed from the cells map.
                            let keys = map_event.keys(txn);
                            for (key, change) in keys {
                                if let Some(cell_id) = parse_cell_id(key) {
                                    let old_value = extract_old_value_from_entry(change, txn);
                                    buffer.cells.push(CellChange {
                                        sheet_id,
                                        cell_id,
                                        kind: entry_change_kind(change),
                                        old_value,
                                    });
                                }
                            }
                        } else if path.len() == 3 {
                            // A cell's internal map (v, f) was updated in place.
                            // Iterate the field-level keys to capture old "v" value.
                            if let Some(PathSegment::Key(hex)) = path.get(2)
                                && let Some(cell_id) = parse_cell_id(hex)
                            {
                                let old_value = {
                                    let field_keys = map_event.keys(txn);
                                    field_keys
                                        .get(crate::schema::KEY_VALUE)
                                        .and_then(|ch| match ch {
                                            EntryChange::Updated(Out::Any(old), _) => {
                                                Some(any_to_cell_value(old))
                                            }
                                            EntryChange::Removed(Out::Any(old)) => {
                                                Some(any_to_cell_value(old))
                                            }
                                            _ => None,
                                        })
                                };
                                buffer.cells.push(CellChange {
                                    sheet_id,
                                    cell_id,
                                    kind: CellChangeKind::Modified,
                                    old_value,
                                });
                            }
                        }
                    }

                    // --- properties ---
                    k if k == KEY_CELL_PROPERTIES => {
                        if path.len() == 2 {
                            let keys = map_event.keys(txn);
                            for (key, change) in keys {
                                if let Some(cell_id) = parse_cell_id(key) {
                                    buffer.properties.push(PropertyCellChange {
                                        sheet_id,
                                        cell_id,
                                        kind: entry_change_kind(change),
                                    });
                                }
                            }
                        } else if path.len() == 3 {
                            // Entry modified in place — cell_id is at path[2].
                            if let Some(PathSegment::Key(hex)) = path.get(2)
                                && let Some(cell_id) = parse_cell_id(hex)
                            {
                                buffer.properties.push(PropertyCellChange {
                                    sheet_id,
                                    cell_id,
                                    kind: CellChangeKind::Modified,
                                });
                            }
                        }
                    }

                    // --- rowHeights ---
                    k if k == KEY_ROW_HEIGHTS => {
                        if path.len() == 2 {
                            let keys = map_event.keys(txn);
                            for (key, change) in keys {
                                buffer.row_heights.push(DimensionCellChange {
                                    sheet_id,
                                    key: key.to_string(),
                                    kind: entry_change_kind(change),
                                });
                            }
                        }
                    }

                    // --- colWidths ---
                    k if k == KEY_COL_WIDTHS => {
                        if path.len() == 2 {
                            let keys = map_event.keys(txn);
                            for (key, change) in keys {
                                buffer.col_widths.push(DimensionCellChange {
                                    sheet_id,
                                    key: key.to_string(),
                                    kind: entry_change_kind(change),
                                });
                            }
                        }
                    }

                    // --- merges ---
                    k if k == KEY_MERGES => {
                        if path.len() == 2 {
                            let keys = map_event.keys(txn);
                            for (key, change) in keys {
                                buffer.merges.push(MergeCellChange {
                                    sheet_id,
                                    key: key.to_string(),
                                    kind: entry_change_kind(change),
                                });
                            }
                        } else if path.len() == 3
                            && let Some(PathSegment::Key(k)) = path.get(2)
                        {
                            buffer.merges.push(MergeCellChange {
                                sheet_id,
                                key: k.to_string(),
                                kind: CellChangeKind::Modified,
                            });
                        }
                    }

                    // --- hiddenRows ---
                    k if k == KEY_HIDDEN_ROWS => {
                        if path.len() == 2 {
                            let keys = map_event.keys(txn);
                            for (key, change) in keys {
                                buffer.hidden_rows.push(VisibilityCellChange {
                                    sheet_id,
                                    key: key.to_string(),
                                    kind: entry_change_kind(change),
                                });
                            }
                        }
                    }

                    // --- hiddenCols ---
                    k if k == KEY_HIDDEN_COLS => {
                        if path.len() == 2 {
                            let keys = map_event.keys(txn);
                            for (key, change) in keys {
                                buffer.hidden_cols.push(VisibilityCellChange {
                                    sheet_id,
                                    key: key.to_string(),
                                    kind: entry_change_kind(change),
                                });
                            }
                        }
                    }

                    // --- comments ---
                    k if k == KEY_COMMENTS => {
                        if path.len() == 2 {
                            let keys = map_event.keys(txn);
                            for (key, change) in keys {
                                buffer.comments.push(CommentCellChange {
                                    sheet_id,
                                    key: key.to_string(),
                                    cell_ref: comment_cell_ref_from_change(change, txn),
                                    kind: entry_change_kind(change),
                                });
                            }
                        } else if path.len() == 3
                            && let Some(PathSegment::Key(k)) = path.get(2)
                        {
                            buffer.comments.push(CommentCellChange {
                                sheet_id,
                                key: k.to_string(),
                                cell_ref: None,
                                kind: CellChangeKind::Modified,
                            });
                        }
                    }

                    // --- filters ---
                    k if k == KEY_FILTERS || k == KEY_FILTER_METADATA_BINDINGS => {
                        push_sheet_level_change(
                            &mut buffer.filters,
                            sheet_id,
                            &path,
                            map_event,
                            txn,
                        );
                    }

                    // --- grouping ---
                    k if k == KEY_GROUPING => {
                        push_sheet_level_change(
                            &mut buffer.grouping,
                            sheet_id,
                            &path,
                            map_event,
                            txn,
                        );
                    }

                    // --- sparklines ---
                    k if k == KEY_SPARKLINES => {
                        push_sheet_level_change(
                            &mut buffer.sparklines,
                            sheet_id,
                            &path,
                            map_event,
                            txn,
                        );
                    }

                    // --- conditionalFormat ---
                    k if k == KEY_CONDITIONAL_FORMAT => {
                        push_sheet_level_change(
                            &mut buffer.conditional_formats,
                            sheet_id,
                            &path,
                            map_event,
                            txn,
                        );
                    }

                    // --- sorting ---
                    k if k == KEY_SORTING => {
                        push_sheet_level_change(
                            &mut buffer.sorting,
                            sheet_id,
                            &path,
                            map_event,
                            txn,
                        );
                    }

                    // --- rowFormats ---
                    k if k == KEY_ROW_FORMATS => {
                        push_sheet_level_change(
                            &mut buffer.row_formats,
                            sheet_id,
                            &path,
                            map_event,
                            txn,
                        );
                    }

                    // --- colFormats ---
                    k if k == KEY_COL_FORMATS => {
                        push_sheet_level_change(
                            &mut buffer.col_formats,
                            sheet_id,
                            &path,
                            map_event,
                            txn,
                        );
                    }

                    // --- floatingObjects ---
                    k if k == KEY_FLOATING_OBJECTS => {
                        if path.len() == 2 {
                            let keys = map_event.keys(txn);
                            for (key, change) in keys {
                                buffer.floating_objects.push(FloatingObjectCellChange {
                                    sheet_id,
                                    object_id: key.to_string(),
                                    kind: entry_change_kind(change),
                                });
                            }
                        } else if path.len() == 3
                            && let Some(PathSegment::Key(k)) = path.get(2)
                        {
                            buffer.floating_objects.push(FloatingObjectCellChange {
                                sheet_id,
                                object_id: k.to_string(),
                                kind: CellChangeKind::Modified,
                            });
                        }
                    }

                    // --- pivotTables ---
                    k if k == KEY_PIVOT_TABLES => {
                        if path.len() == 2 {
                            let keys = map_event.keys(txn);
                            for (key, change) in keys {
                                buffer.pivot_tables.push(PivotCellChange {
                                    sheet_id,
                                    pivot_id: key.to_string(),
                                    kind: entry_change_kind(change),
                                });
                            }
                        } else if path.len() == 3
                            && let Some(PathSegment::Key(k)) = path.get(2)
                        {
                            buffer.pivot_tables.push(PivotCellChange {
                                sheet_id,
                                pivot_id: k.to_string(),
                                kind: CellChangeKind::Modified,
                            });
                        }
                    }

                    // --- meta ---
                    k if k == KEY_PROPERTIES => {
                        if path.len() == 2 {
                            let keys = map_event.keys(txn);
                            for (key, change) in keys {
                                buffer.sheet_meta.push(SheetMetaChange {
                                    sheet_id,
                                    field: Some(key.to_string()),
                                    kind: entry_change_kind(change),
                                });
                            }
                        } else if path.len() == 3 {
                            let field = match path.get(2) {
                                Some(PathSegment::Key(k)) => Some(k.to_string()),
                                _ => None,
                            };
                            buffer.sheet_meta.push(SheetMetaChange {
                                sheet_id,
                                field,
                                kind: CellChangeKind::Modified,
                            });
                        }
                    }

                    // --- Authoritative yrs-side identity: gridIndex ---
                    // `gridIndex/posToId` maps "rowHex:colHex" -> cellHex
                    // and is the CRDT-synchronised position-to-CellId
                    // store (post-R51). Entry inserts and removals
                    // here must propagate into the receiving engine's
                    // in-memory `GridIndex` — otherwise metadata-only
                    // writes (comments, formats, hyperlinks on an
                    // empty cell) leave the peer unable to resolve
                    // the new cell's position. `idToPos` is the
                    // inverse map; we observe only `posToId` to
                    // avoid double-counting.
                    "gridIndex" => {
                        if path.len() == 3
                            && let Some(PathSegment::Key(sub)) = path.get(2)
                            && sub.as_ref() == "posToId"
                        {
                            let keys = map_event.keys(txn);
                            for (pos_key, change) in keys {
                                let Some((row_hex, col_hex)) = pos_key.split_once(':') else {
                                    continue;
                                };
                                if row_hex.is_empty() || col_hex.is_empty() {
                                    continue;
                                }
                                let cell_id_opt = match change {
                                    EntryChange::Inserted(Out::Any(Any::String(s)))
                                    | EntryChange::Updated(_, Out::Any(Any::String(s))) => {
                                        parse_cell_id(s.as_ref())
                                    }
                                    EntryChange::Removed(Out::Any(Any::String(s))) => {
                                        parse_cell_id(s.as_ref())
                                    }
                                    _ => None,
                                };
                                let Some(cell_id) = cell_id_opt else {
                                    continue;
                                };
                                buffer.grid_index.push(GridIndexCellChange {
                                    sheet_id,
                                    cell_id,
                                    row_hex: row_hex.to_string(),
                                    col_hex: col_hex.to_string(),
                                    kind: entry_change_kind(change),
                                });
                            }
                        }
                        // `idToPos` and the `gridIndex` sub-map
                        // entry itself: no events emitted.
                    }

                    // --- Structural YArray changes: rowOrder/colOrder ---
                    // rowOrder/colOrder YArray changes indicate structural mutations
                    // (row/col insert/delete/reorder). Detect them for rebuild.
                    "rowOrder" | "colOrder" => {
                        let axis = axis_order_axis(sub_map_key.as_ref()).expect("matched axis");
                        push_axis_order_change(
                            buffer,
                            sheet_id,
                            axis,
                            AxisOrderChangeKind::Structural,
                            txn.origin().map(|origin| origin.as_ref().to_vec()),
                        );
                    }

                    // --- Unknown sub-maps: silently skip ---
                    // When new sub-maps are added to the schema, they will hit this
                    // arm. No crash, no noise — add a match arm when ready.
                    _ => {}
                }
            }
            // YArray events: detect rowOrder/colOrder structural changes.
            Event::Array(arr_event) => {
                let path = arr_event.path();
                // path = [sheetHex, "rowOrder"|"colOrder"]
                if path.len() >= 2
                    && let Some(PathSegment::Key(sub_key)) = path.get(1)
                    && let Some(axis) = axis_order_axis(sub_key.as_ref())
                    && let Some(sheet_id) = extract_sheet_id(&path)
                {
                    let kind =
                        axis_order_change_kind(arr_event.delta(txn), arr_event.target().len(txn));
                    push_axis_order_change(
                        buffer,
                        sheet_id,
                        axis,
                        kind,
                        txn.origin().map(|origin| origin.as_ref().to_vec()),
                    );
                }
            }
            // Other event types — skip.
            _ => {}
        }
    }
}

/// Helper: push a sheet-level change for sub-maps where we track entries
/// at a coarse granularity (key + kind).
fn push_sheet_level_change(
    target: &mut Vec<SheetLevelChange>,
    sheet_id: SheetId,
    path: &VecDeque<PathSegment>,
    map_event: &yrs::types::map::MapEvent,
    txn: &TransactionMut,
) {
    if path.len() == 2 {
        let keys = map_event.keys(txn);
        for (key, change) in keys {
            target.push(SheetLevelChange {
                sheet_id,
                key: Some(key.to_string()),
                kind: entry_change_kind(change),
            });
        }
    } else if path.len() >= 3 {
        // Deeper modification — report the entry key from path[2].
        let key = match path.get(2) {
            Some(PathSegment::Key(k)) => Some(k.to_string()),
            _ => None,
        };
        target.push(SheetLevelChange {
            sheet_id,
            key,
            kind: CellChangeKind::Modified,
        });
    }
}
