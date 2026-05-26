//! Shared test helpers for the relational compute engine tests.

use crate::types::*;
use value_types::CellValue;

pub(super) fn identity_field(id: &str, col: usize) -> GroupField {
    GroupField {
        id: id.to_string(),
        column_index: col,
        grouping: GroupingStrategy::Identity,
        sort: SortConfig {
            sort_by: SortBy::Label,
            direction: SortDirection::Ascending,
            custom_order: None,
        },
    }
}

pub(super) fn sum_measure(id: &str, col: usize) -> Measure {
    Measure {
        id: id.to_string(),
        name: format!("Sum of {id}"),
        column_index: col,
        aggregate: AggregateFunction::Sum,
        window: None,
    }
}

pub(super) fn make_measure(id: &str, col: usize, agg: AggregateFunction) -> Measure {
    Measure {
        id: id.to_string(),
        name: format!("{id}"),
        column_index: col,
        aggregate: agg,
        window: None,
    }
}

pub(super) fn base_query() -> RelationalQuery {
    RelationalQuery {
        row_fields: vec![],
        column_fields: vec![],
        measures: vec![],
        filters: vec![],
        calculated_measures: vec![],
        subtotals: SubtotalConfig { enabled: vec![] },
        grand_totals: GrandTotalConfig {
            show_row: false,
            show_column: false,
        },
    }
}

pub(super) fn text(s: &str) -> CellValue {
    CellValue::Text(s.into())
}

pub(super) fn num(n: f64) -> CellValue {
    CellValue::number(n)
}

/// Find a node by display value (text) in a flat list of nodes.
pub(super) fn find_node<'a>(nodes: &'a [AggregatedNode], label: &str) -> &'a AggregatedNode {
    nodes
        .iter()
        .find(|n| n.value == text(label))
        .unwrap_or_else(|| panic!("Node with label '{label}' not found"))
}

/// Find a child node by label within a parent node.
pub(super) fn find_child<'a>(parent: &'a AggregatedNode, label: &str) -> &'a AggregatedNode {
    parent
        .children
        .iter()
        .find(|n| n.value == text(label))
        .unwrap_or_else(|| panic!("Child with label '{label}' not found in '{}'", parent.key))
}
