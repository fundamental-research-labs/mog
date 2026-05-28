use compute_parser::ReferenceTokenClass;

use crate::mirror::CellMirror;
use crate::range_manager::pos_to_a1;

use super::edges::{PendingEdge, edge_code, external_mapping};
use super::page::stable_hash_parts;
use super::resolver::DiagnosticResolver;
use super::sources::{SourceFormula, normalize_display_formula};
use super::types::{
    ExternalLinkStatus, FormulaReferenceAddressStatus, FormulaReferenceBaseDiagnostic,
    FormulaReferenceDiagnostic, FormulaReferenceDiagnosticsOptions, FormulaReferenceEdgeDiagnostic,
    FormulaReferenceEdgeDiagnosticRow, FormulaReferenceEdgeKind, FormulaReferenceEdgeStatus,
    FormulaReferenceLocation, FormulaReferenceParseDiagnosticRow, FormulaReferenceParseKind,
    FormulaReferenceParseSourceReason, FormulaReferenceSeverity, FormulaReferenceTargetKind,
};
use super::visitor::collect_ast_edges;

pub(super) fn collect_source_rows(
    mirror: &CellMirror,
    source: &SourceFormula,
    options: &FormulaReferenceDiagnosticsOptions,
    snapshot_version: &str,
    rows: &mut Vec<FormulaReferenceDiagnostic>,
) {
    let formula = normalize_display_formula(&source.formula);
    let tokens = compute_parser::collect_reference_tokens(&formula);
    let parsed =
        compute_parser::parse_formula(&formula, Some(&DiagnosticResolver { mirror, source }));
    match parsed {
        Ok(ast) => {
            for edge in collect_ast_edges(mirror, source, &tokens, &ast.node) {
                push_edge(rows, source, snapshot_version, edge);
            }
        }
        Err(err) => rows.push(parse_row(
            source,
            snapshot_version,
            Some(err.span.start.saturating_add(1)),
            Some(err.span.end.saturating_add(1)),
            FormulaReferenceParseSourceReason::ParserError,
        )),
    }

    for token in tokens
        .iter()
        .filter(|t| t.class == ReferenceTokenClass::BrokenRef)
    {
        push_edge(
            rows,
            source,
            snapshot_version,
            PendingEdge::from_token(
                token,
                FormulaReferenceEdgeKind::DeletedCell,
                FormulaReferenceTargetKind::Cell,
                FormulaReferenceEdgeStatus::Deleted,
                "authored #REF! token".to_string(),
            ),
        );
    }

    for link in &options.external_links.records {
        if link.status == ExternalLinkStatus::Ready {
            continue;
        }
        let Some(token) = tokens
            .iter()
            .find(|t| {
                t.class == ReferenceTokenClass::ExternalRef
                    && t.text.contains(&link.safe_display_name)
            })
            .or_else(|| {
                tokens
                    .iter()
                    .find(|t| t.class == ReferenceTokenClass::ExternalRef)
            })
        else {
            continue;
        };
        let (kind, severity, status) = external_mapping(link);
        if severity == FormulaReferenceSeverity::Warning && !options.include_warnings {
            continue;
        }
        let mut edge = PendingEdge::from_token(
            token,
            kind,
            FormulaReferenceTargetKind::External,
            status,
            link.status_reason
                .map_or_else(|| format!("{:?}", link.status), |r| format!("{r:?}")),
        );
        edge.severity = severity;
        edge.link_id = Some(link.link_id.clone());
        edge.target_display = Some(if link.status == ExternalLinkStatus::Denied {
            "Access denied external reference".to_string()
        } else {
            link.safe_display_name.clone()
        });
        push_edge(rows, source, snapshot_version, edge);
    }
}

fn push_edge(
    rows: &mut Vec<FormulaReferenceDiagnostic>,
    source: &SourceFormula,
    snapshot_version: &str,
    pending: PendingEdge,
) {
    let span_start = pending.span_start.to_string();
    let span_end = pending.span_end.to_string();
    let ref_index = pending
        .ref_index
        .map_or_else(String::new, |v| v.to_string());
    let kind = format!("{:?}", pending.kind);
    let status = format!("{:?}", pending.status);
    let edge_id = stable_hash_parts(&[
        &source.source_stable_id,
        &source.formula,
        &span_start,
        &span_end,
        &pending.text,
        &ref_index,
    ]);
    let id = stable_hash_parts(&[
        snapshot_version,
        &source.source_stable_id,
        &span_start,
        &span_end,
        &pending.text,
        &kind,
        &status,
    ]);
    rows.push(FormulaReferenceDiagnostic::ReferenceEdge(
        FormulaReferenceEdgeDiagnosticRow {
            base: FormulaReferenceBaseDiagnostic {
                id,
                source_kind: source.source_kind,
                severity: pending.severity,
                code: edge_code(pending.kind).to_string(),
                location: location(source),
                formula: Some(normalize_display_formula(&source.formula)),
                display_value: None,
            },
            kind: pending.kind,
            edge: FormulaReferenceEdgeDiagnostic {
                edge_id,
                text: pending.text,
                span_start: pending.span_start,
                span_end: pending.span_end,
                ref_index: pending.ref_index,
                target_kind: pending.target_kind,
                target_display: pending.target_display,
                target_sheet_id: pending.target_sheet_id,
                target_cell_id: pending.target_cell_id,
                target_name_id: pending.target_name_id,
                target_table_id: pending.target_table_id,
                target_column_name: pending.target_column_name,
                link_id: pending.link_id,
                status: pending.status,
                reason: pending.reason,
            },
        },
    ));
}

fn parse_row(
    source: &SourceFormula,
    snapshot_version: &str,
    span_start: Option<u32>,
    span_end: Option<u32>,
    source_reason: FormulaReferenceParseSourceReason,
) -> FormulaReferenceDiagnostic {
    let span_start_hash = span_start.map_or_else(String::new, |v| v.to_string());
    let span_end_hash = span_end.map_or_else(String::new, |v| v.to_string());
    let id = stable_hash_parts(&[
        snapshot_version,
        &source.source_stable_id,
        &span_start_hash,
        &span_end_hash,
        "parse-error",
    ]);
    FormulaReferenceDiagnostic::Parse(FormulaReferenceParseDiagnosticRow {
        base: FormulaReferenceBaseDiagnostic {
            id,
            source_kind: source.source_kind,
            severity: FormulaReferenceSeverity::Error,
            code: "formula-reference.parse-error".to_string(),
            location: location(source),
            formula: Some(normalize_display_formula(&source.formula)),
            display_value: None,
        },
        kind: FormulaReferenceParseKind::ParseError,
        span_start,
        span_end,
        source_reason,
    })
}

fn location(source: &SourceFormula) -> FormulaReferenceLocation {
    FormulaReferenceLocation {
        sheet_id: source.sheet_id,
        cell_id: source.cell_id,
        address: source.row.zip(source.col).map(|(r, c)| pos_to_a1(r, c)),
        row: source.row,
        col: source.col,
        name_id: source.name_id.clone(),
        name: source.name.clone(),
        address_status: if source.cell_id.is_some() {
            FormulaReferenceAddressStatus::Resolved
        } else {
            FormulaReferenceAddressStatus::NotCellBacked
        },
    }
}

pub(super) fn sort_key(
    row: &FormulaReferenceDiagnostic,
) -> (String, u32, u32, u8, u32, u32, String) {
    match row {
        FormulaReferenceDiagnostic::ReferenceEdge(r) => (
            r.base
                .location
                .sheet_id
                .map(|s| s.to_uuid_string())
                .unwrap_or_default(),
            r.base.location.row.unwrap_or(u32::MAX),
            r.base.location.col.unwrap_or(u32::MAX),
            0,
            r.edge.span_start,
            r.edge.span_end,
            r.edge.edge_id.clone(),
        ),
        FormulaReferenceDiagnostic::Parse(r) => (
            r.base
                .location
                .sheet_id
                .map(|s| s.to_uuid_string())
                .unwrap_or_default(),
            r.base.location.row.unwrap_or(u32::MAX),
            r.base.location.col.unwrap_or(u32::MAX),
            1,
            r.span_start.unwrap_or(u32::MAX),
            r.span_end.unwrap_or(u32::MAX),
            r.base.id.clone(),
        ),
    }
}
