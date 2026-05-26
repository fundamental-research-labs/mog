//! Calculated measures — post-aggregation computed values.
//!
//! Walks the tree and evaluates `CalcExpr` at each node, appending
//! calculated measure values after the regular measure values.

use std::collections::HashMap;

use value_types::CellValue;

use crate::types::{AggregatedNode, CalcExpr, CalcOp, CalculatedMeasure, Measure};

/// Maximum expression evaluation depth to prevent stack overflow.
const MAX_DEPTH: usize = 100;

/// Apply calculated measures to all nodes in the row tree.
///
/// For each node, evaluates each calculated measure expression using the
/// node's existing aggregated values as field references. Appends the
/// calculated values to the node's `values` and `subtotal_values` arrays.
pub(crate) fn apply_calculated_measures(
    row_tree: &mut [AggregatedNode],
    measures: &[Measure],
    calculated_measures: &[CalculatedMeasure],
    num_column_leaves: usize,
) {
    if calculated_measures.is_empty() {
        return;
    }

    for node in row_tree.iter_mut() {
        apply_to_node(node, measures, calculated_measures, num_column_leaves);
    }
}

/// Recursively apply calculated measures to a node and its children.
fn apply_to_node(
    node: &mut AggregatedNode,
    measures: &[Measure],
    calculated_measures: &[CalculatedMeasure],
    num_column_leaves: usize,
) {
    // Recurse first.
    for child in &mut node.children {
        apply_to_node(child, measures, calculated_measures, num_column_leaves);
    }

    // Apply to this node's values.
    node.values = apply_calc_to_values(
        &node.values,
        measures,
        calculated_measures,
        num_column_leaves,
    );

    // Apply to subtotal_values if present.
    if let Some(ref subtotals) = node.subtotal_values {
        node.subtotal_values = Some(apply_calc_to_values(
            subtotals,
            measures,
            calculated_measures,
            num_column_leaves,
        ));
    }
}

/// Apply calculated measures to a flat values array.
///
/// Input layout: [`col0_m0`, `col0_m1`, ..., `col1_m0`, ...]
/// Output layout: [`col0_m0`, `col0_m1`, ..., `col0_calc0`, ..., `col1_m0`, `col1_m1`, ..., `col1_calc0`, ...]
///
/// # Field-name resolution (table dependency work T11 fix)
///
/// Calculated-field formulas like `Revenue / Cost` reference measures by
/// name. The pre-fix behaviour put `Measure.name = source field name`
/// into the field map, which collided when the same source field was
/// placed in values multiple times (e.g. `"Sum of Revenue" + "Avg of Revenue"`
/// both end up as `Revenue` and the second insert overwrites the first).
///
/// The fix adds *output-id* keys (`col0`, `col1`, …) alongside the source-
/// field-name keys. Output id is durable across rename and unambiguous when
/// the same source field appears multiple times. The source-field-name key
/// is preserved for formula readability — on collision, the **first** measure
/// wins, matching Excel's deterministic resolution. Authors can disambiguate
/// by referring to `col0`/`col1`/…
///
/// The measure id (typically the source field id) is also inserted as a
/// secondary key for callers that already address by id.
fn apply_calc_to_values(
    values: &[CellValue],
    measures: &[Measure],
    calculated_measures: &[CalculatedMeasure],
    num_column_leaves: usize,
) -> Vec<CellValue> {
    let num_measures = measures.len();
    let num_calc = calculated_measures.len();
    let new_stride = num_measures + num_calc;
    let num_cols = num_column_leaves.max(1);
    let mut result = Vec::with_capacity(num_cols * new_stride);

    // Pre-compute the col-index keys once (they don't depend on column leaf).
    // Keep them as String so the HashMap can borrow `&str`.
    let col_keys: Vec<String> = (0..num_measures).map(|i| format!("col{i}")).collect();

    for col_idx in 0..num_cols {
        let start = col_idx * num_measures;

        // Copy regular values for this column leaf.
        for i in 0..num_measures {
            let val = values.get(start + i).cloned().unwrap_or(CellValue::Null);
            result.push(val);
        }

        // Build field name -> value map from the regular values.
        //
        // Insertion order:
        //   1. col0 / col1 / ... (output-id, always unique)
        //   2. source field name (first-wins on duplicate)
        //   3. measure id (typically source field id; first-wins)
        //
        // First-wins is chosen via `entry().or_insert(..)` so duplicate-
        // source-field-name placements (the bug from Finding 5) resolve
        // to the leftmost aggregate in the value-placement order — a
        // deterministic policy that matches Excel.
        let mut field_map: HashMap<&str, f64> = HashMap::new();
        for (i, measure) in measures.iter().enumerate() {
            if let Some(CellValue::Number(n)) = values.get(start + i)
                && n.is_finite()
            {
                let v = n.get();
                // Output id — always unique.
                field_map.insert(col_keys[i].as_str(), v);
                // Source field name — first-wins on collision.
                field_map.entry(measure.name.as_str()).or_insert(v);
                // Measure id — first-wins on collision.
                field_map.entry(measure.id.as_str()).or_insert(v);
            }
        }

        // Evaluate each calculated measure.
        for calc in calculated_measures {
            match &calc.parsed_expr {
                Some(expr) => match evaluate_calc_expr(expr, &field_map) {
                    Some(v) => result.push(CellValue::number(v)),
                    None => result.push(CellValue::Null),
                },
                None => result.push(CellValue::Null),
            }
        }
    }

    result
}

/// Evaluate a calculated expression given field values.
///
/// Field name lookup is case-insensitive.
/// Returns `None` for missing fields, division by zero, or non-finite results.
fn evaluate_calc_expr(expr: &CalcExpr, field_values: &HashMap<&str, f64>) -> Option<f64> {
    evaluate_inner(expr, field_values, 0)
}

fn evaluate_inner(expr: &CalcExpr, field_values: &HashMap<&str, f64>, depth: usize) -> Option<f64> {
    if depth > MAX_DEPTH {
        return None;
    }
    match expr {
        CalcExpr::Number(n) => Some(*n),
        CalcExpr::Field(name) => {
            // Case-insensitive field lookup.
            field_values
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(name))
                .map(|(_, v)| *v)
        }
        CalcExpr::BinaryOp { op, left, right } => {
            let l = evaluate_inner(left, field_values, depth + 1)?;
            let r = evaluate_inner(right, field_values, depth + 1)?;
            let result = match op {
                CalcOp::Add => l + r,
                CalcOp::Sub => l - r,
                CalcOp::Mul => l * r,
                CalcOp::Div => {
                    if r == 0.0 {
                        return None;
                    }
                    l / r
                }
            };
            if result.is_finite() {
                Some(result)
            } else {
                None
            }
        }
        CalcExpr::UnaryNeg(inner) => {
            let v = evaluate_inner(inner, field_values, depth + 1)?;
            Some(-v)
        }
    }
}
