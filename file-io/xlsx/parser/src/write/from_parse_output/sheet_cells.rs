use std::collections::HashSet;

use domain_types::{
    AuthoredStyleRun, CellData as DomainCellData, CellValue as DomainValue, DataTableRegion,
    SheetData,
};
use value_types::CellError;

use super::super::SharedStringsWriter;
use super::sheet_formulas::{
    current_formula_metadata, data_table_formula_text, data_table_master_formula_map,
    is_data_table_body_formula, shared_formula_export_plan,
};
use super::style_remap::StyleExportRemapper;
use crate::write::sheet::{CellData, CellValue, SheetWriter};

pub(super) fn apply_cells(
    writer: &mut SheetWriter,
    sheet_data: &SheetData,
    shared_strings: &mut SharedStringsWriter,
    data_table_body_positions: &HashSet<(u32, u32)>,
    data_table_regions: &[DataTableRegion],
    emit_cell_metadata_refs: bool,
    style_remapper: &StyleExportRemapper,
) {
    let data_table_master_formulas = data_table_master_formula_map(data_table_regions);
    let shared_formula_plan = shared_formula_export_plan(&sheet_data.cells);
    let _shared_formula_diagnostics = &shared_formula_plan.diagnostics;
    let authored_style_at = |row: u32, col: u32| -> Option<u32> {
        sheet_data
            .authored_style_runs
            .iter()
            .filter(|run| {
                row >= run.start_row
                    && row <= run.end_row
                    && col >= run.start_col
                    && col <= run.end_col
            })
            .map(|run| run.style_id)
            .next_back()
    };
    for cell in &sheet_data.cells {
        let key = (cell.row, cell.col);
        let is_data_table_master = data_table_master_formulas.contains_key(&key)
            || cell.cell_formula.as_ref().is_some_and(|formula| {
                formula.t == ooxml_types::worksheet::CellFormulaType::DataTable
            });
        // Data Table body cells carry a synthesized `=TABLE(r2, r1)` formula
        // in the data model. The OOXML representation only emits
        // `<f t="dataTable">` on the master cell.
        let writer_cell = if data_table_body_positions.contains(&key)
            || is_data_table_body_formula(cell, is_data_table_master)
        {
            let mut sanitized = cell.clone();
            sanitized.formula = None;
            sanitized.cell_formula = None;
            if sanitized.style_id.is_none() {
                sanitized.style_id = authored_style_at(sanitized.row, sanitized.col);
            }
            convert_cell_with_metadata_refs(
                &sanitized,
                shared_strings,
                emit_cell_metadata_refs,
                style_remapper,
            )
        } else {
            let mut canonical = cell.clone();
            if canonical.style_id.is_none() {
                canonical.style_id = authored_style_at(canonical.row, canonical.col);
            }
            canonical.cell_formula = shared_formula_plan
                .metadata_for(canonical.row, canonical.col)
                .cloned()
                .or_else(|| current_formula_metadata(&canonical).cloned());
            if let Some(cell_formula) = data_table_master_formulas.get(&key) {
                canonical.cell_formula = Some(cell_formula.clone());
                if canonical.formula.is_none() {
                    canonical.formula = Some(data_table_formula_text(cell_formula));
                }
            }
            convert_cell_with_metadata_refs(
                &canonical,
                shared_strings,
                emit_cell_metadata_refs,
                style_remapper,
            )
        };
        writer.add_cell(writer_cell);
    }
    for run in &sheet_data.authored_style_runs {
        if let Some(style_id) = style_remapper
            .emitted_cell_xf_id(run.style_id)
            .or_else(|| (run.style_id == 0).then_some(0))
        {
            writer.add_authored_style_run(AuthoredStyleRun {
                start_row: run.start_row,
                start_col: run.start_col,
                end_row: run.end_row,
                end_col: run.end_col,
                style_id,
            });
        }
    }
}

/// Convert a domain `CellData` into a writer `CellData`.
#[cfg(test)]
pub(super) fn convert_cell(
    cell: &DomainCellData,
    shared_strings: &mut SharedStringsWriter,
) -> CellData {
    let style_remapper = StyleExportRemapper::palette_projection(u32::MAX);
    convert_cell_with_metadata_refs(cell, shared_strings, true, &style_remapper)
}

fn convert_cell_with_metadata_refs(
    cell: &DomainCellData,
    shared_strings: &mut SharedStringsWriter,
    emit_cell_metadata_refs: bool,
    style_remapper: &StyleExportRemapper,
) -> CellData {
    let style_index = cell
        .style_id
        .and_then(|id| style_remapper.emitted_cell_xf_id(id));

    let authored_numeric_value = matching_authored_numeric_value(cell);
    let value = match (&cell.value, &cell.formula) {
        (_, Some(formula)) => {
            let cached = match &cell.value {
                DomainValue::Number(n) => Some(Box::new(CellValue::Number(n.get()))),
                DomainValue::Text(s) => {
                    Some(Box::new(CellValue::FormulaString(s.as_ref().to_string())))
                }
                DomainValue::Boolean(b) => Some(Box::new(CellValue::Boolean(*b))),
                DomainValue::Error(_, _) if authored_numeric_value.is_some() => {
                    Some(Box::new(CellValue::Number(0.0)))
                }
                DomainValue::Error(e, _) => {
                    Some(Box::new(CellValue::Error(e.as_str().to_string())))
                }
                _ if cell.has_empty_cached_value => Some(Box::new(CellValue::Number(0.0))),
                _ => None,
            };
            CellValue::Formula {
                formula: formula.clone(),
                cached_value: cached,
                cell_formula: cell.cell_formula.clone(),
            }
        }
        (DomainValue::Number(n), None) => CellValue::Number(n.get()),
        (DomainValue::Text(s), None) if compatible_date_lexical_value(cell).is_some() => {
            CellValue::FormulaString(s.as_ref().to_string())
        }
        (DomainValue::Text(s), None) => {
            if cell.formula_result_type == Some(6) {
                CellValue::FormulaString(s.as_ref().to_string())
            } else if let Some(rich) = current_rich_string(cell, s.as_ref()) {
                let sst_idx = shared_strings.add_rich_shared_string(rich);
                CellValue::String(sst_idx)
            } else {
                let sst_idx = shared_strings.add(s.as_ref());
                CellValue::String(sst_idx)
            }
        }
        (DomainValue::Boolean(b), None) => CellValue::Boolean(*b),
        (DomainValue::Error(CellError::Num, _), None) if authored_numeric_value.is_some() => {
            CellValue::Number(0.0)
        }
        (DomainValue::Error(e, _), None) => CellValue::Error(e.as_str().to_string()),
        _ => CellValue::Empty,
    };

    let formula_type_hint = cell.formula_result_type.and_then(|t| match t {
        6 => Some("str".to_string()),
        4 => Some("e".to_string()),
        3 => Some("b".to_string()),
        7 => Some("d".to_string()),
        _ => None,
    });

    CellData {
        row: cell.row,
        col: cell.col,
        value,
        style_index,
        original_value: if cell.has_empty_cached_value {
            Some(String::new())
        } else {
            authored_numeric_value
        },
        force_recalc: current_force_recalc(cell),
        cell_metadata_index: emit_cell_metadata_refs
            .then_some(cell.cell_metadata_index)
            .flatten(),
        vm: emit_cell_metadata_refs.then_some(cell.vm).flatten(),
        preserve_space_formula: false,
        preserve_space_value: false,
        explicit_type: None,
        formula_type_hint,
        phonetic: cell.phonetic,
        date_lexical_value: compatible_date_lexical_value(cell),
    }
}

fn current_force_recalc(cell: &DomainCellData) -> bool {
    cell.formula_cache_provenance.state.is_current() && cell.formula_cache_provenance.force_recalc
}

fn compatible_date_lexical_value(cell: &DomainCellData) -> Option<String> {
    let date = cell.date_lexical_value.as_ref()?;
    match &cell.value {
        DomainValue::Text(s) if s.as_ref() == date => Some(date.clone()),
        _ => None,
    }
}

fn current_rich_string(
    cell: &DomainCellData,
    text: &str,
) -> Option<domain_types::RichSharedString> {
    let rich = cell.rich_string.as_ref()?;
    (rich.plain_text == text).then(|| rich.clone())
}

fn matching_authored_numeric_value(cell: &DomainCellData) -> Option<String> {
    let original = cell.original_value.as_ref()?;
    let parsed = original.parse::<f64>().ok()?;

    match &cell.value {
        DomainValue::Number(current) if parsed.is_finite() && parsed == current.get() => {
            Some(original.clone())
        }
        DomainValue::Error(CellError::Num, _) if !parsed.is_finite() => Some(original.clone()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use value_types::FiniteF64;

    fn text_cell(value: &str, original_sst_index: Option<u32>) -> DomainCellData {
        DomainCellData {
            row: 0,
            col: 0,
            value: DomainValue::Text(Arc::from(value)),
            original_sst_index,
            original_value: original_sst_index.map(|idx| idx.to_string()),
            ..Default::default()
        }
    }

    fn number_cell(value: f64, original_value: Option<&str>) -> DomainCellData {
        DomainCellData {
            row: 0,
            col: 0,
            value: DomainValue::Number(FiniteF64::must(value)),
            original_value: original_value.map(str::to_string),
            ..Default::default()
        }
    }

    #[test]
    fn original_numeric_value_is_preserved_when_it_matches_current_value() {
        let mut shared_strings = SharedStringsWriter::new();
        let converted = convert_cell(
            &number_cell(7.039265000250605e27, Some("7.039265000250605e+27")),
            &mut shared_strings,
        );

        assert_eq!(
            converted.original_value.as_deref(),
            Some("7.039265000250605e+27")
        );
    }

    #[test]
    fn authored_non_finite_numeric_value_is_preserved_for_canonical_num_error() {
        let mut shared_strings = SharedStringsWriter::new();
        let cell = DomainCellData {
            row: 0,
            col: 0,
            value: DomainValue::Error(CellError::Num, None),
            original_value: Some("NaN".to_string()),
            ..Default::default()
        };

        let converted = convert_cell(&cell, &mut shared_strings);

        assert!(matches!(&converted.value, CellValue::Number(_)));
        assert_eq!(converted.original_value.as_deref(), Some("NaN"));
    }

    #[test]
    fn stale_non_finite_numeric_value_is_ignored_for_non_num_error() {
        let mut shared_strings = SharedStringsWriter::new();
        let cell = DomainCellData {
            row: 0,
            col: 0,
            value: DomainValue::Error(CellError::Value, None),
            original_value: Some("NaN".to_string()),
            ..Default::default()
        };

        let converted = convert_cell(&cell, &mut shared_strings);

        assert!(matches!(&converted.value, CellValue::Error(e) if e == "#VALUE!"));
        assert_eq!(converted.original_value, None);
    }

    #[test]
    fn stale_original_numeric_value_is_ignored() {
        let mut shared_strings = SharedStringsWriter::new();
        let converted = convert_cell(&number_cell(2.0, Some("1.0")), &mut shared_strings);

        assert_eq!(converted.original_value, None);
    }

    #[test]
    fn empty_text_cell_derives_shared_string_entry() {
        let mut shared_strings = SharedStringsWriter::with_capacity(1);
        let converted = convert_cell(&text_cell("", Some(0)), &mut shared_strings);

        assert!(matches!(&converted.value, CellValue::String(0)));
        assert_eq!(converted.explicit_type, None);
        assert_eq!(shared_strings.total_count(), 1);
    }

    #[test]
    fn original_sst_index_is_ignored_for_current_text_export() {
        let mut shared_strings = SharedStringsWriter::with_capacity(1);
        let converted = convert_cell(&text_cell("current", Some(99)), &mut shared_strings);

        assert!(matches!(&converted.value, CellValue::String(0)));
        assert!(!matches!(&converted.value, CellValue::String(99)));
    }

    #[test]
    fn stale_original_sst_index_does_not_seed_shared_strings() {
        let mut shared_strings = SharedStringsWriter::with_capacity(1);
        let converted = convert_cell(&text_cell("new", Some(0)), &mut shared_strings);

        assert!(matches!(&converted.value, CellValue::String(0)));
    }

    #[test]
    fn explicit_empty_formula_cached_value_converts_to_empty_original_value() {
        let mut shared_strings = SharedStringsWriter::new();
        let cell = DomainCellData {
            row: 0,
            col: 0,
            value: DomainValue::Null,
            formula: Some("A2".to_string()),
            has_empty_cached_value: true,
            ..Default::default()
        };

        let converted = convert_cell(&cell, &mut shared_strings);

        assert_eq!(converted.original_value.as_deref(), Some(""));
        assert!(matches!(
            converted.value,
            CellValue::Formula {
                cached_value: Some(_),
                ..
            }
        ));
    }
}
