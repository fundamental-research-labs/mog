//! Invalidate imported chart replay when worksheet source cells change.
//!
//! An imported standard chart carries authored XML and caches that are valid
//! only while the cells behind its live references are unchanged. Cell edits
//! arrive here as recalculation changes, so this module keeps the invalidation
//! scoped to charts whose A1 source ranges contain one of those cells.

use std::collections::HashMap;

use domain_types::ChartSpec;
use domain_types::chart::StandardChartAuthorityValidity;
use domain_types::domain::floating_object::FloatingObjectData;
use snapshot_types::RecalcResult;

use super::{ComputeEngine, services};
use cell_types::SheetId;

const SOURCE_STALE_REASON: &str = "chart source cells changed";

impl ComputeEngine {
    pub(in crate::storage::engine) fn invalidate_chart_source_replays(
        &mut self,
        recalc: &RecalcResult,
    ) {
        if recalc.changed_cells.is_empty() {
            return;
        }

        let changes: Vec<Option<(SheetId, u32, u32)>> = recalc
            .changed_cells
            .iter()
            .map(|change| {
                let sheet_id = SheetId::from_uuid_str(&change.sheet_id).ok()?;
                let position = change.position.as_ref()?;
                Some((sheet_id, position.row, position.col))
            })
            .collect();
        let sheet_names: HashMap<SheetId, String> = self
            .stores
            .storage
            .sheet_order()
            .into_iter()
            .filter_map(|sheet_id| {
                services::queries::get_sheet_name(&self.stores, &sheet_id)
                    .map(|name| (sheet_id, name))
            })
            .collect();

        for owner_sheet_id in self.stores.storage.sheet_order() {
            let Some(owner_sheet_name) =
                services::queries::get_sheet_name(&self.stores, &owner_sheet_id)
            else {
                continue;
            };
            let objects =
                services::objects::get_all_floating_objects_typed(&self.stores, &owner_sheet_id);
            for object in objects {
                let FloatingObjectData::Chart(chart_data) = &object.data else {
                    continue;
                };
                let Some(chart_spec) = ChartSpec::from_floating_object(&object) else {
                    continue;
                };
                if chart_spec.is_chart_ex || !has_live_source_refs(&chart_spec) {
                    continue;
                }
                if !chart_source_changed(&chart_spec, &owner_sheet_name, &changes, &sheet_names) {
                    continue;
                }

                let Some(mut ooxml) = chart_data.ooxml.clone() else {
                    continue;
                };
                let Some(mut authority) = ooxml.standard_chart_export_authority.take() else {
                    continue;
                };
                if authority.validity == StandardChartAuthorityValidity::Stale
                    && authority.stale_reason.as_deref() == Some(SOURCE_STALE_REASON)
                {
                    continue;
                }
                authority.validity = StandardChartAuthorityValidity::Stale;
                authority.chart_part_revision = authority.chart_part_revision.saturating_add(1);
                authority.stale_reason = Some(SOURCE_STALE_REASON.to_string());
                ooxml.standard_chart_export_authority = Some(authority);

                let Ok(ooxml_json) = serde_json::to_value(ooxml) else {
                    continue;
                };
                let updates = serde_json::json!({ "ooxml": ooxml_json });
                // Replay authority is derived from source edits, and must not
                // create a separate history action or clear the redo stack.
                self.without_history(|engine| {
                    crate::storage::sheet::floating_objects::update_floating_object(
                        &mut engine.stores.storage,
                        &owner_sheet_id,
                        &object.common.id,
                        &updates,
                    );
                });
            }
        }
    }
}

fn has_live_source_refs(chart: &ChartSpec) -> bool {
    chart
        .data_range
        .as_deref()
        .is_some_and(|reference| !reference.trim().is_empty())
        || chart
            .series_range
            .as_deref()
            .is_some_and(|reference| !reference.trim().is_empty())
        || chart
            .category_range
            .as_deref()
            .is_some_and(|reference| !reference.trim().is_empty())
        || chart
            .title_formula
            .as_deref()
            .is_some_and(|reference| !reference.trim().is_empty())
        || chart.series.iter().any(|series| {
            series
                .name_ref
                .as_deref()
                .is_some_and(|reference| !reference.trim().is_empty())
                || live_ref(series.values.as_deref(), series.value_source_kind)
                || live_ref(series.categories.as_deref(), series.category_source_kind)
                || live_ref(
                    series.bubble_size.as_deref(),
                    series.bubble_size_source_kind,
                )
        })
}

fn live_ref(
    reference: Option<&str>,
    source_kind: Option<domain_types::chart::ChartSeriesDimensionSourceKindData>,
) -> bool {
    reference.is_some_and(|reference| !reference.trim().is_empty())
        && matches!(
            source_kind,
            None | Some(domain_types::chart::ChartSeriesDimensionSourceKindData::Ref)
        )
}

fn chart_source_changed(
    chart: &ChartSpec,
    owner_sheet_name: &str,
    changes: &[Option<(SheetId, u32, u32)>],
    sheet_names: &HashMap<SheetId, String>,
) -> bool {
    let mut references = Vec::new();
    let mut has_unresolved_dependency = false;
    for reference in [
        chart.data_range.as_deref(),
        chart.series_range.as_deref(),
        chart.category_range.as_deref(),
        chart.title_formula.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        references.push(reference);
    }
    for series in &chart.series {
        references.extend(series.name_ref.as_deref());
        if live_ref(series.values.as_deref(), series.value_source_kind) {
            references.extend(series.values.as_deref());
        }
        if live_ref(series.categories.as_deref(), series.category_source_kind) {
            references.extend(series.categories.as_deref());
        }
        if live_ref(
            series.bubble_size.as_deref(),
            series.bubble_size_source_kind,
        ) {
            references.extend(series.bubble_size.as_deref());
        }
    }

    for reference in references {
        let trimmed = reference.trim().trim_start_matches('=').trim();
        if trimmed.is_empty() {
            continue;
        }
        let Some(range) = crate::range_manager::parse_range(trimmed) else {
            // A named range, table reference, or external A1 reference has no
            // safe positional intersection test. Keep the conservative
            // invalidation for those dependencies. An authored #REF! source
            // is different: it is an unresolved cache owner, and an unrelated
            // edit must not discard its only meaningful cache evidence.
            if !is_broken_chart_source_reference(trimmed) {
                has_unresolved_dependency = true;
            }
            continue;
        };
        let referenced_sheet = range
            .sheet_name
            .as_deref()
            .map(|name| name.replace("''", "'"))
            .unwrap_or_else(|| owner_sheet_name.to_string());
        let start_row = range.start.row.min(range.end.row);
        let end_row = range.start.row.max(range.end.row);
        let start_col = range.start.col.min(range.end.col);
        let end_col = range.start.col.max(range.end.col);

        for change in changes {
            let Some((changed_sheet_id, row, col)) = change else {
                continue;
            };
            let Some(changed_sheet_name) = sheet_names.get(changed_sheet_id) else {
                // The caller already supplied a valid sheet id; an unavailable
                // name is still unsafe to treat as unchanged.
                return true;
            };
            if changed_sheet_name.eq_ignore_ascii_case(&referenced_sheet)
                && (start_row..=end_row).contains(row)
                && (start_col..=end_col).contains(col)
            {
                return true;
            }
        }
    }

    // Named ranges, table references, external refs, and other syntaxes that
    // cannot be reduced to an A1 rectangle remain live dependencies. Any
    // workbook edit can affect one of them, so invalidate conservatively. An
    // authored #REF! is intentionally excluded above: it has no resolvable
    // dependency and its cache is the only remaining evidence to preserve.
    has_unresolved_dependency && !changes.is_empty()
}

fn is_broken_chart_source_reference(reference: &str) -> bool {
    reference.to_ascii_uppercase().contains("#REF!")
}
