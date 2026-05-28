use serde_json::Value;

use crate::types::{BinSpec, DataRow};

use super::grid::{calculate_bins, find_bin_index};

/// Apply a bin transform to data rows.
pub fn apply_bin(
    data: &[DataRow],
    field: &str,
    as_field: &str,
    maxbins: Option<usize>,
    step: Option<f64>,
    nice: Option<bool>,
) -> Vec<DataRow> {
    let values: Vec<f64> = data
        .iter()
        .filter_map(|row| match row.get(field) {
            Some(Value::Number(n)) => n.as_f64().filter(|v| v.is_finite()),
            _ => None,
        })
        .collect();

    let end_field = format!("{as_field}_end");

    if values.is_empty() {
        return data
            .iter()
            .map(|row| {
                let mut out = row.clone();
                out.insert(as_field.to_string(), Value::Null);
                out.insert(end_field.clone(), Value::Null);
                out
            })
            .collect();
    }

    let bins = calculate_bins(&values, maxbins, step, nice);

    data.iter()
        .map(|row| {
            let mut out = row.clone();

            match row
                .get(field)
                .and_then(|v| v.as_f64())
                .filter(|v| v.is_finite())
            {
                Some(val) => {
                    let idx = find_bin_index(val, &bins);
                    let bin_start = bins.start + (idx as f64) * bins.step;
                    let bin_end = bin_start + bins.step;
                    out.insert(as_field.to_string(), Value::from(bin_start));
                    out.insert(end_field.clone(), Value::from(bin_end));
                }
                None => {
                    out.insert(as_field.to_string(), Value::Null);
                    out.insert(end_field.clone(), Value::Null);
                }
            }

            out
        })
        .collect()
}

/// Apply a bin transform to data rows from a `BinSpec`.
pub fn apply_bin_spec(data: &[DataRow], spec: &BinSpec) -> Vec<DataRow> {
    apply_bin(
        data,
        &spec.field,
        &spec.as_field,
        spec.maxbins,
        spec.step,
        spec.nice,
    )
}
