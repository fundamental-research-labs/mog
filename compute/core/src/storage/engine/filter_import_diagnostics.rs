use cell_types::{CellId, SheetId};
use compute_document::hex::hex_to_id;

use crate::mirror::CellMirror;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::filters;

pub(in crate::storage::engine) fn unsupported_filter_import_diagnostic(
    binding: &filters::FilterMetadataBinding,
    sheet_index: Option<u32>,
    sheet_name: Option<String>,
    source_key: Option<String>,
    object_id: Option<String>,
    filter_col_id: Option<u32>,
    table_column_ordinal: Option<u32>,
    resolved_cell: Option<(u32, u32)>,
    reasons: Vec<filters::ImportFilterUnsupportedReason>,
    filter_kind: String,
    feature: domain_types::ImportFeatureKind,
) -> domain_types::ImportDiagnostic {
    let code = domain_types::ImportDiagnosticCode::UnsupportedFeature;
    let part = sheet_index.map(|idx| format!("sheet:{idx}"));
    let (row, col) = resolved_cell
        .map(|(row, col)| (Some(row), Some(col)))
        .unwrap_or((None, None));
    let cell_ref = resolved_cell.map(|(row, col)| cell_ref_from_pos(row, col));
    let identity = format!(
        "{}:{}:{}:{}",
        binding.source_fingerprint,
        filter_col_id
            .map(|value| value.to_string())
            .unwrap_or_default(),
        table_column_ordinal
            .map(|value| value.to_string())
            .unwrap_or_default(),
        reason_tokens(&reasons).join("|")
    );
    let message = format!(
        "Imported AutoFilter criterion was preserved but cannot be applied: {}",
        reason_tokens(&reasons).join(", ")
    );

    domain_types::ImportDiagnostic {
        id: domain_types::deterministic_diagnostic_id(
            &code,
            part.as_deref(),
            None,
            row,
            col,
            Some(&identity),
        ),
        code: code.clone(),
        severity: domain_types::ImportSeverity::Warning,
        feature,
        recoverability: domain_types::ImportRecoverability::UnsupportedPreserved,
        message: message.clone(),
        reference: Some(domain_types::ImportDiagnosticRef {
            code: Some(code),
            message: Some(message),
            part,
            sheet_index,
            sheet_name,
            source_range: Some(binding.range_ref.clone()),
            feature_kind: Some(feature),
            object_id,
            filter_col_id,
            table_column_ordinal,
            unresolved_filter_col_id: filter_col_id.filter(|_| resolved_cell.is_none()),
            unresolved_table_column_ordinal: table_column_ordinal
                .filter(|_| resolved_cell.is_none()),
            row,
            col,
            cell_ref,
            ..domain_types::ImportDiagnosticRef::default()
        }),
        details: Some(domain_types::ImportDiagnosticDetails::UnsupportedFilter {
            reasons,
            filter_id: Some(binding.filter_id.clone()),
            filter_kind: Some(filter_kind),
            source_key,
            filter_col_id,
            table_column_ordinal,
            resolved_col: col,
        }),
        import_phases: Vec::new(),
        first_import_phase: None,
    }
}

pub(in crate::storage::engine) fn upsert_import_diagnostic_phase(
    report: &mut domain_types::ImportReport,
    mut diagnostic: domain_types::ImportDiagnostic,
    phase: domain_types::ImportPhase,
) {
    if let Some(existing) = report
        .diagnostics
        .iter_mut()
        .find(|existing| existing.id == diagnostic.id)
    {
        if !existing.import_phases.contains(&phase) {
            existing.import_phases.push(phase);
            existing.import_phases.sort();
        }
        existing.first_import_phase = Some(
            existing
                .first_import_phase
                .map(|first| first.min(phase))
                .unwrap_or(phase),
        );
        report.canonicalize();
        return;
    }

    diagnostic.import_phases = vec![phase];
    diagnostic.first_import_phase = Some(phase);
    report.diagnostics.push(diagnostic);
    report.canonicalize();
}

pub(in crate::storage::engine) fn resolve_filter_cell_pos(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    cell_id_hex: &str,
) -> Option<(u32, u32)> {
    let id = hex_to_id(cell_id_hex)?;
    let cell_id = CellId::from_raw(id);
    if let Some(pos) = mirror.resolve_position(&cell_id) {
        return Some((pos.row(), pos.col()));
    }
    stores
        .grid_indexes
        .get(sheet_id)
        .and_then(|grid| grid.cell_position(&cell_id))
}

fn reason_tokens(reasons: &[filters::ImportFilterUnsupportedReason]) -> Vec<String> {
    reasons
        .iter()
        .map(|reason| {
            serde_json::to_string(reason)
                .unwrap_or_else(|_| format!("{reason:?}"))
                .trim_matches('"')
                .to_string()
        })
        .collect()
}

fn cell_ref_from_pos(row: u32, col: u32) -> String {
    format!("{}{}", column_name(col), row + 1)
}

fn column_name(mut zero_based_col: u32) -> String {
    let mut name = String::new();
    loop {
        let rem = zero_based_col % 26;
        name.insert(0, (b'A' + rem as u8) as char);
        if zero_based_col < 26 {
            break;
        }
        zero_based_col = zero_based_col / 26 - 1;
    }
    name
}
