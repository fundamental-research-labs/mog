//! Replay notifications are derived after all native identity/value swaps finish.
use super::*;
use crate::identity::GridIndex;
use crate::snapshot::*;
use crate::storage::{properties, sheet};
use domain_types::units::{LayoutMetrics, char_width_to_pixels, points_to_pixels};
use rustc_hash::{FxHashMap, FxHashSet};

#[derive(Debug, Default)]
struct Before {
    cell: Option<CellId>,
    position: Option<(u32, u32)>,
    name: Option<String>,
    object_kind: Option<domain_types::domain::floating_object::FloatingObjectKind>,
    existed: bool,
    merges: Vec<(u32, u32, u32, u32)>,
    hidden_rows: Vec<RowId>,
    sheet: Option<String>,
}
#[derive(Debug, Default)]
pub(crate) struct MetadataEvents(FxHashMap<MetadataKey, Before>);
impl MetadataEvents {
    pub(crate) fn record(
        &mut self,
        key: &MetadataKey,
        storage: &WorkbookStorage,
        mirror: &CellMirror,
    ) {
        self.0.entry(key.clone()).or_insert_with(|| {
            let mut before = Before::default();
            match key {
                MetadataKey::SheetEntry(sid, field, id) => {
                    if let Some(meta) = storage.sheet_metadata.get(sid) {
                        match *field {
                            "comments" => {
                                if let Some(value) = meta.comments.iter().find(|v| v.id == *id) {
                                    before.cell = value.cell_ref.cell();
                                    before.existed = true;
                                }
                            }
                            "sparklines.items" => {
                                if let Some(value) = meta.sparklines.items.get(id) {
                                    before.position = Some((value.cell.row, value.cell.col));
                                    before.existed = true;
                                }
                            }
                            "floating_objects.objects" => {
                                if let Some(value) = meta.floating_objects.objects.get(id) {
                                    before.object_kind = Some(value.kind());
                                    before.existed = true;
                                }
                            }
                            "floating_objects.groups" => {
                                before.existed = meta.floating_objects.groups.contains_key(id)
                            }
                            _ => {}
                        }
                    }
                }
                MetadataKey::SheetField(sid, "merges") => {
                    if let (Some(meta), Some(sheet)) =
                        (storage.sheet_metadata.get(sid), mirror.get_sheet(sid))
                    {
                        before.merges = meta
                            .merges
                            .iter()
                            .filter_map(|merge| {
                                let a = sheet.position_of(&merge.top_left_id)?;
                                let b = sheet.position_of(&merge.bottom_right_id)?;
                                Some((a.row(), a.col(), b.row(), b.col()))
                            })
                            .collect();
                    }
                }
                MetadataKey::SheetField(sid, "properties") => {
                    before.name = sheet::properties::get_sheet_meta(storage, sid)
                        .and_then(|meta| meta.tab_color)
                }
                MetadataKey::SheetField(sid, "name") => {
                    before.name = storage
                        .sheet_metadata
                        .get(sid)
                        .map(|meta| meta.name.clone())
                }
                MetadataKey::FilterHiddenRows(sid, id) => {
                    before.hidden_rows = storage
                        .sheet_metadata
                        .get(sid)
                        .and_then(|meta| meta.dimensions.filter_hidden_rows.get(id))
                        .map(|v| v.iter().copied().collect())
                        .unwrap_or_default()
                }
                MetadataKey::WorkbookEntry("named_ranges", id) => {
                    before.name = storage
                        .metadata
                        .named_ranges
                        .get(id)
                        .map(|v| v.name.clone())
                }
                MetadataKey::WorkbookEntry("slicers", id) => {
                    if let Some(value) = storage.metadata.slicers.get(id) {
                        before.sheet = Some(value.sheet_id.clone());
                        before.existed = true;
                    }
                }
                _ => {}
            }
            before
        });
    }
}
fn camel(field: &str) -> String {
    let field = field.rsplit('.').next().unwrap_or(field);
    let mut result = String::new();
    let mut upper = false;
    for ch in field.chars() {
        if ch == '_' {
            upper = true;
        } else if upper {
            result.extend(ch.to_uppercase());
            upper = false;
        } else {
            result.push(ch);
        }
    }
    result
}
fn kind(exists: bool) -> ChangeKind {
    if exists {
        ChangeKind::Set
    } else {
        ChangeKind::Removed
    }
}
fn position(mirror: &CellMirror, sheet: SheetId, cell: CellId) -> Option<CellPosition> {
    mirror
        .get_sheet(&sheet)?
        .position_of(&cell)
        .map(|pos| CellPosition {
            row: pos.row(),
            col: pos.col(),
        })
}
fn sheet_change(sid: SheetId, field: SheetChangeField) -> SheetChange {
    SheetChange {
        sheet_id: sid.to_uuid_string(),
        kind: ChangeKind::Set,
        field,
        name: None,
        old_name: None,
        index: None,
        old_index: None,
        hidden: None,
        source_sheet_id: None,
        frozen_rows: None,
        old_frozen_rows: None,
        frozen_cols: None,
        old_frozen_cols: None,
        color: None,
        old_color: None,
    }
}

pub(crate) fn emit_events(
    storage: &WorkbookStorage,
    mirror: &CellMirror,
    grids: &FxHashMap<SheetId, GridIndex>,
    metrics: LayoutMetrics,
    effects: &mut HistoryEffects,
) {
    let events = std::mem::take(&mut effects.metadata_events.0);
    let mut workbook_keys = FxHashSet::default();
    for (key, before) in events {
        match key {
            MetadataKey::CellProperties(sid, id) => {
                let format = properties::get_cell_format(storage, &sid, &id.to_uuid_string());
                effects.result.property_changes.push(PropertyChange {
                    sheet_id: sid.to_uuid_string(),
                    cell_id: id.to_uuid_string(),
                    position: position(mirror, sid, id).or_else(|| {
                        effects.cells.get(&id).map(|(_, row, col)| CellPosition {
                            row: *row,
                            col: *col,
                        })
                    }),
                    kind: kind(format.is_some()),
                    format: format.and_then(|f| serde_json::to_value(f).ok()),
                });
            }
            MetadataKey::Row(sid, id) => {
                if let Some(index) = grids.get(&sid).and_then(|grid| grid.row_index(&id)) {
                    let size = value_types::FiniteF64::new(
                        points_to_pixels(sheet::dimensions::get_row_height_stored(
                            storage,
                            &sid,
                            index,
                            grids.get(&sid),
                        ))
                        .0,
                    );
                    effects.format_rects.push((sid, index, 0, index, u32::MAX));
                    effects.result.dimension_changes.push(DimensionChange {
                        sheet_id: sid.to_uuid_string(),
                        axis: Axis::Row,
                        index,
                        kind: ChangeKind::Set,
                        size,
                    });
                }
            }
            MetadataKey::Column(sid, id) => {
                if let Some(index) = grids.get(&sid).and_then(|grid| grid.col_index(&id)) {
                    let width = sheet::dimensions::get_col_width_explicit(
                        storage,
                        &sid,
                        index,
                        grids.get(&sid),
                    )
                    .unwrap_or_else(|| {
                        sheet::dimensions::get_sheet_default_col_width(storage, &sid)
                    });
                    let size = value_types::FiniteF64::new(
                        char_width_to_pixels(width, metrics.column_width_mdw).0,
                    );
                    effects.format_rects.push((sid, 0, index, u32::MAX, index));
                    effects.result.dimension_changes.push(DimensionChange {
                        sheet_id: sid.to_uuid_string(),
                        axis: Axis::Col,
                        index,
                        kind: ChangeKind::Set,
                        size,
                    });
                }
            }
            MetadataKey::HiddenRow(sid, id) => {
                if let Some(index) = grids.get(&sid).and_then(|grid| grid.row_index(&id)) {
                    effects.result.visibility_changes.push(VisibilityChange {
                        sheet_id: sid.to_uuid_string(),
                        axis: Axis::Row,
                        index,
                        hidden: sheet::dimensions::is_row_hidden(
                            storage,
                            &sid,
                            index,
                            grids.get(&sid),
                        ),
                    });
                }
            }
            MetadataKey::HiddenColumn(sid, id) => {
                if let Some(index) = grids.get(&sid).and_then(|grid| grid.col_index(&id)) {
                    effects.result.visibility_changes.push(VisibilityChange {
                        sheet_id: sid.to_uuid_string(),
                        axis: Axis::Col,
                        index,
                        hidden: sheet::dimensions::is_column_hidden(
                            storage,
                            &sid,
                            index,
                            grids.get(&sid),
                        ),
                    });
                }
            }
            MetadataKey::FilterHiddenRows(sid, id) => {
                let mut rows: FxHashSet<_> = before.hidden_rows.into_iter().collect();
                if let Some(current) = storage
                    .sheet_metadata
                    .get(&sid)
                    .and_then(|meta| meta.dimensions.filter_hidden_rows.get(&id))
                {
                    rows.extend(current);
                }
                for row in rows {
                    if let Some(index) = grids.get(&sid).and_then(|grid| grid.row_index(&row)) {
                        effects.result.visibility_changes.push(VisibilityChange {
                            sheet_id: sid.to_uuid_string(),
                            axis: Axis::Row,
                            index,
                            hidden: sheet::dimensions::is_row_hidden(
                                storage,
                                &sid,
                                index,
                                grids.get(&sid),
                            ),
                        });
                    }
                }
            }
            MetadataKey::SheetEntry(sid, field, id) => {
                let Some(meta) = storage.sheet_metadata.get(&sid) else {
                    continue;
                };
                match field {
                    "comments" => {
                        let comment = meta.comments.iter().find(|v| v.id == id);
                        if let Some(cell) = comment.and_then(|v| v.cell_ref.cell()).or(before.cell)
                        {
                            effects.result.comment_changes.push(CommentChange {
                                sheet_id: sid.to_uuid_string(),
                                cell_id: cell.to_uuid_string(),
                                position: position(mirror, sid, cell),
                                kind: kind(comment.is_some()),
                            });
                        }
                    }
                    "sparklines.items" => {
                        let item = meta.sparklines.items.get(&id);
                        if let Some((row, col)) =
                            item.map(|v| (v.cell.row, v.cell.col)).or(before.position)
                        {
                            let cell =
                                mirror.resolve_cell_id(&sid, cell_types::SheetPos::new(row, col));
                            effects.result.sparkline_changes.push(SparklineChange {
                                sheet_id: sid.to_uuid_string(),
                                cell_id: cell.map(|id| id.to_uuid_string()).unwrap_or_default(),
                                position: Some(CellPosition { row, col }),
                                kind: kind(item.is_some()),
                            });
                        }
                    }
                    "conditional_formats" => effects.result.cf_changes.push(CfChange {
                        sheet_id: sid.to_uuid_string(),
                        kind: kind(meta.conditional_formats.contains_key(&id)),
                        rule_id: Some(id),
                    }),
                    "pivots" => effects.result.pivot_changes.push(PivotTableChange {
                        sheet_id: sid.to_uuid_string(),
                        pivot_id: id.clone(),
                        kind: kind(meta.pivots.contains_key(&id)),
                    }),
                    "filters" | "filter_bindings" => {
                        let value = meta.filters.get(&id);
                        effects.result.filter_changes.push(FilterChange {
                            sheet_id: sid.to_uuid_string(),
                            filter_id: id,
                            filter_kind: value
                                .and_then(|v| serde_json::to_value(&v.filter_kind).ok())
                                .and_then(|v| v.as_str().map(str::to_owned)),
                            table_id: value.and_then(|v| v.table_id.clone()),
                            capability: None,
                            unsupported_reasons: Vec::new(),
                            has_active_filter: value.map(|v| !v.column_filters.is_empty()),
                            clearable: None,
                            diagnostics: Vec::new(),
                            action: Some(
                                if value.is_some() {
                                    "updated"
                                } else {
                                    "deleted"
                                }
                                .into(),
                            ),
                            hidden_row_count: None,
                            visible_row_count: None,
                            kind: kind(value.is_some()),
                        });
                    }
                    "floating_objects.objects" | "floating_objects.groups" => {
                        let object = meta.floating_objects.objects.get(&id);
                        let group = field == "floating_objects.groups";
                        let exists = if group {
                            meta.floating_objects.groups.contains_key(&id)
                        } else {
                            object.is_some()
                        };
                        let change = FloatingObjectChange {
                            sheet_id: sid.to_uuid_string(),
                            object_id: id,
                            kind: if !exists {
                                FloatingObjectChangeKind::Removed
                            } else if !before.existed {
                                FloatingObjectChangeKind::Created
                            } else {
                                FloatingObjectChangeKind::Updated {
                                    changed_fields: Vec::new(),
                                }
                            },
                            object_type: object.map(|v| v.kind()).or(before.object_kind),
                            data: if group {
                                None
                            } else {
                                object.map(|v| v.as_ref().clone())
                            },
                            bounds: None,
                        };
                        if group {
                            effects.result.floating_object_group_changes.push(change);
                        } else {
                            effects.result.floating_object_changes.push(change);
                        }
                    }
                    _ => {}
                }
            }
            MetadataKey::SheetField(sid, field) => {
                let Some(meta) = storage.sheet_metadata.get(&sid) else {
                    continue;
                };
                match field {
                    "merges" => {
                        let old: FxHashSet<_> = before.merges.into_iter().collect();
                        let current: FxHashSet<_> = grids
                            .get(&sid)
                            .map(|grid| {
                                meta.merges
                                    .iter()
                                    .filter_map(|v| v.resolve(grid))
                                    .map(|v| (v.start_row, v.start_col, v.end_row, v.end_col))
                                    .collect()
                            })
                            .unwrap_or_default();
                        for (range, change_kind) in old
                            .difference(&current)
                            .map(|v| (v, ChangeKind::Removed))
                            .chain(current.difference(&old).map(|v| (v, ChangeKind::Set)))
                        {
                            effects.result.merge_changes.push(MergeChange {
                                sheet_id: sid.to_uuid_string(),
                                kind: change_kind,
                                start_row: range.0,
                                start_col: range.1,
                                end_row: range.2,
                                end_col: range.3,
                            });
                        }
                    }
                    "name" => {
                        let mut c = sheet_change(sid, SheetChangeField::Name);
                        c.name = Some(meta.name.clone());
                        c.old_name = before.name;
                        effects.result.sheet_changes.push(c);
                    }
                    "visibility" => {
                        for field in [SheetChangeField::Hidden, SheetChangeField::Visibility] {
                            let mut c = sheet_change(sid, field);
                            c.hidden = Some(meta.visibility != domain_types::SheetState::Visible);
                            effects.result.sheet_changes.push(c);
                        }
                    }
                    "properties" => {
                        let color = sheet::properties::get_sheet_meta(storage, &sid)
                            .and_then(|meta| meta.tab_color);
                        if color != before.name {
                            let mut c = sheet_change(sid, SheetChangeField::TabColor);
                            c.color = color;
                            c.old_color = before.name;
                            effects.result.sheet_changes.push(c);
                        }
                    }
                    "enable_calculation" => effects
                        .result
                        .sheet_changes
                        .push(sheet_change(sid, SheetChangeField::EnableCalculation)),
                    "view.pane" => {
                        let pane = sheet::view::get_frozen_panes(storage, &sid);
                        let mut c = sheet_change(sid, SheetChangeField::Frozen);
                        c.frozen_rows = Some(pane.rows);
                        c.frozen_cols = Some(pane.cols);
                        effects.result.sheet_changes.push(c);
                    }
                    "page_breaks" => effects.result.page_break_changes.push(PageBreakChange {
                        sheet_id: sid.to_uuid_string(),
                        breaks: sheet::print::get_page_breaks(storage, &sid),
                    }),
                    "print_areas" => effects.result.print_area_changes.push(PrintAreaChange {
                        sheet_id: sid.to_uuid_string(),
                        kind: kind(!meta.print_areas.is_empty()),
                        area: meta.print_areas.first().cloned(),
                    }),
                    "print_titles" => effects.result.print_titles_changes.push(PrintTitlesChange {
                        sheet_id: sid.to_uuid_string(),
                        titles: meta.print_titles.clone(),
                    }),
                    "print_settings" => {
                        effects
                            .result
                            .print_settings_changes
                            .push(PrintSettingsChange {
                                sheet_id: sid.to_uuid_string(),
                                settings: sheet::print::get_print_settings(storage, &sid),
                            })
                    }
                    "split_config" => effects.result.split_config_changes.push(SplitConfigChange {
                        sheet_id: sid.to_uuid_string(),
                        kind: kind(meta.split_config.is_some()),
                        config: meta.split_config.clone(),
                    }),
                    "grouping" => {
                        for axis in [Axis::Row, Axis::Col] {
                            effects.result.grouping_changes.push(GroupingChange {
                                sheet_id: sid.to_uuid_string(),
                                axis,
                                kind: ChangeKind::Set,
                            });
                        }
                    }
                    field
                        if field.starts_with("view.")
                            || matches!(
                                field,
                                "protection"
                                    | "gridline_color"
                                    | "custom_properties"
                                    | "format.default_row_height"
                                    | "format.default_col_width"
                            ) =>
                    {
                        effects.result.settings_changes.push(SheetSettingsChange {
                            sheet_id: sid.to_uuid_string(),
                            kind: ChangeKind::Set,
                            changed_key: if field == "view.show_zeros" {
                                "showZeroValues".into()
                            } else if field == "protection" {
                                "protectionDetails".into()
                            } else {
                                camel(field)
                            },
                            settings: serde_json::to_value(
                                sheet::settings::get_sheet_settings_with_layout_metrics(
                                    storage, &sid, metrics,
                                ),
                            )
                            .expect("typed sheet settings"),
                        });
                    }
                    _ => {}
                }
            }
            MetadataKey::WorkbookField(field) => {
                if field == "sheet_order" {
                    for (index, sid) in storage.metadata.sheet_order.iter().enumerate() {
                        let mut c = sheet_change(*sid, SheetChangeField::Order);
                        c.index = Some(index as i32);
                        effects.result.sheet_changes.push(c);
                    }
                } else {
                    match field {
                        "properties" => {
                            workbook_keys.insert("date1904".into());
                        }
                        "protection" => {
                            for key in [
                                "isWorkbookProtected",
                                "workbookProtectionPasswordHash",
                                "workbookProtectionOptions",
                            ] {
                                workbook_keys.insert(key.into());
                            }
                        }
                        _ => {
                            workbook_keys.insert(camel(field));
                        }
                    }
                    if matches!(
                        field,
                        "theme"
                            | "style_palette"
                            | "stylesheet"
                            | "settings.theme_id"
                            | "settings.theme_fonts_id"
                            | "settings.culture"
                            | "properties"
                    ) {
                        effects.format_rects.extend(
                            mirror
                                .sheet_ids()
                                .map(|sid| (*sid, 0, 0, u32::MAX, u32::MAX)),
                        );
                    }
                }
            }
            MetadataKey::WorkbookEntry(
                "custom_cell_styles" | "custom_table_styles" | "named_slicer_styles",
                _,
            ) => {
                effects.format_rects.extend(
                    mirror
                        .sheet_ids()
                        .map(|sid| (*sid, 0, 0, u32::MAX, u32::MAX)),
                );
            }
            MetadataKey::WorkbookEntry("named_ranges", id) => {
                let current = storage.metadata.named_ranges.get(&id);
                effects.result.named_range_changes.push(NamedRangeChange {
                    name: current
                        .map(|v| v.name.clone())
                        .or(before.name)
                        .unwrap_or(id),
                    kind: kind(current.is_some()),
                });
            }
            MetadataKey::WorkbookEntry("slicers", id) => {
                let current = storage.metadata.slicers.get(&id);
                if let Some(sheet_id) = current.map(|v| v.sheet_id.clone()).or(before.sheet) {
                    effects.result.slicer_changes.push(SlicerChange {
                        sheet_id,
                        slicer_id: id,
                        kind: if current.is_none() {
                            SlicerChangeKind::Deleted
                        } else if before.existed {
                            SlicerChangeKind::Updated
                        } else {
                            SlicerChangeKind::Created
                        },
                        source_type: None,
                        source_id: None,
                        updated_fields: Vec::new(),
                        selected_values: None,
                        selection_change_type: None,
                        data: current.cloned(),
                    });
                }
            }
            _ => {}
        }
    }
    if !workbook_keys.is_empty() {
        let mut changed_keys: Vec<_> = workbook_keys.into_iter().collect();
        changed_keys.sort();
        effects
            .result
            .workbook_settings_changes
            .push(WorkbookSettingsChange {
                kind: ChangeKind::Set,
                changed_keys,
                settings: serde_json::to_value(crate::storage::workbook::settings::get_settings(
                    &storage.metadata,
                ))
                .expect("typed workbook settings"),
            });
    }
}
