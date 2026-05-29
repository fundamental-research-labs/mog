use crate::domain::pivot::read::PivotTable;
use pivot_types::{
    AxisPlacement, FieldId, FilterPlacement, PivotField, PivotFieldPlacement, PivotValueSource,
    PlacementBase, PlacementId, ValuePlacement,
};

use super::sort::{resolve_sort, resolve_sort_by_value};
use super::value_map::{convert_show_data_as, convert_subtotal};
use crate::domain::pivot::read::PivotCache;

pub(super) fn build_placements(
    pivot: &PivotTable,
    cache: &PivotCache,
    fields: &[PivotField],
    data_field_ids: &[FieldId],
    is_tabular: bool,
) -> Vec<PivotFieldPlacement> {
    let mut placements = Vec::new();

    for (pos, field_ref) in pivot.row_fields.iter().enumerate() {
        if field_ref.x < 0 {
            continue;
        }
        let field_idx = field_ref.x as usize;
        if let Some(field) = fields.get(field_idx) {
            let pf = pivot.pivot_fields.get(field_idx);
            let show_subtotals =
                pf.map(|fd| fd.default_subtotal && (is_tabular || !fd.subtotal_top));
            let (sort_order, custom_sort_list) = resolve_sort(pf, cache, field_idx);
            let sort_by_value = resolve_sort_by_value(pf, &sort_order, data_field_ids, cache);
            let effective_sort_order = if sort_by_value.is_some() {
                None
            } else {
                sort_order
            };
            placements.push(PivotFieldPlacement::Row(AxisPlacement {
                base: PlacementBase {
                    field_id: field.id.clone(),
                    placement_id: parsed_pivot_placement_id(&pivot.name, "row", pos, &field.id),
                    position: pos,
                    display_name: pf.and_then(|fd| display_name_override(fd, field)),
                },
                sort_order: effective_sort_order,
                custom_sort_list,
                sort_by_value,
                date_grouping: None,
                number_grouping: None,
                show_subtotals,
            }));
        }
    }

    for (pos, field_ref) in pivot.col_fields.iter().enumerate() {
        if field_ref.x < 0 {
            continue;
        }
        let field_idx = field_ref.x as usize;
        if let Some(field) = fields.get(field_idx) {
            let pf = pivot.pivot_fields.get(field_idx);
            let show_subtotals =
                pf.map(|fd| fd.default_subtotal && (is_tabular || !fd.subtotal_top));
            let (sort_order, custom_sort_list) = resolve_sort(pf, cache, field_idx);
            let sort_by_value = resolve_sort_by_value(pf, &sort_order, data_field_ids, cache);
            let effective_sort_order = if sort_by_value.is_some() {
                None
            } else {
                sort_order
            };
            placements.push(PivotFieldPlacement::Column(AxisPlacement {
                base: PlacementBase {
                    field_id: field.id.clone(),
                    placement_id: parsed_pivot_placement_id(&pivot.name, "column", pos, &field.id),
                    position: pos,
                    display_name: pf.and_then(|fd| display_name_override(fd, field)),
                },
                sort_order: effective_sort_order,
                custom_sort_list,
                sort_by_value,
                date_grouping: None,
                number_grouping: None,
                show_subtotals,
            }));
        }
    }

    for (pos, data_field) in pivot.data_fields.iter().enumerate() {
        let field_idx = data_field.field_index as usize;
        if let Some(field) = fields.get(field_idx) {
            let show_values_as =
                convert_show_data_as(&data_field.show_data_as, data_field.base_field, fields);
            placements.push(PivotFieldPlacement::Value(ValuePlacement {
                base: PlacementBase {
                    field_id: field.id.clone(),
                    placement_id: parsed_pivot_placement_id(&pivot.name, "value", pos, &field.id),
                    position: pos,
                    display_name: data_field.name.clone(),
                },
                source: PivotValueSource::Field {
                    field_id: field.id.clone(),
                },
                aggregate_function: convert_subtotal(&data_field.subtotal),
                number_format: None,
                show_values_as,
            }));
        }
    }

    for (pos, page_field) in pivot.page_fields.iter().enumerate() {
        let field_idx = page_field.field_index as usize;
        if let Some(field) = fields.get(field_idx) {
            placements.push(PivotFieldPlacement::Filter(FilterPlacement {
                base: PlacementBase {
                    field_id: field.id.clone(),
                    placement_id: parsed_pivot_placement_id(&pivot.name, "filter", pos, &field.id),
                    position: pos,
                    display_name: page_field.name.clone().filter(|name| name != &field.name),
                },
            }));
        }
    }

    placements
}

fn display_name_override(
    field_def: &crate::domain::pivot::read::PivotField,
    field: &PivotField,
) -> Option<String> {
    field_def
        .name
        .clone()
        .filter(|display_name| display_name != &field.name)
}

fn parsed_pivot_placement_id(
    pivot_name: &str,
    area: &str,
    position: usize,
    field_id: &FieldId,
) -> PlacementId {
    PlacementId::new(format!(
        "xlsx:{}:{}:{}:{}",
        sanitize_pivot_id_part(pivot_name),
        area,
        position,
        sanitize_pivot_id_part(field_id.as_str())
    ))
}

fn sanitize_pivot_id_part(value: &str) -> String {
    value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placement_id_sanitizes_pivot_and_field_parts() {
        assert_eq!(
            parsed_pivot_placement_id(&"Pivot 1/West", "row", 2, &FieldId::from("Sales $"))
                .as_str(),
            "xlsx:Pivot_1_West:row:2:Sales__"
        );
    }
}
