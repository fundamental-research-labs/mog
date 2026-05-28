use super::*;

pub(super) fn append_object_import_diagnostics(
    parse_output: &ParseOutput,
    diagnostics: &mut ParseDiagnostics,
) {
    let mut report = diagnostics.clone().into_import_report();

    for (sheet_idx, sheet) in parse_output.sheets.iter().enumerate() {
        for chart in &sheet.charts {
            let Some(status) = chart.import_status.as_ref() else {
                continue;
            };
            let Some(diagnostic) = degraded_object_diagnostic(status, sheet_idx) else {
                continue;
            };

            diagnostics
                .errors
                .push(domain_types::ParseError::from(diagnostic.clone()));
            report.diagnostics.push(diagnostic);
            report.object_statuses.push(status.clone());
        }

        for object in &sheet.floating_objects {
            let Some(status) = object.common.import_status.as_ref() else {
                continue;
            };
            let Some(diagnostic) = degraded_object_diagnostic(status, sheet_idx) else {
                continue;
            };

            diagnostics
                .errors
                .push(domain_types::ParseError::from(diagnostic.clone()));
            report.diagnostics.push(diagnostic);
            report.object_statuses.push(status.clone());
        }
    }

    diagnostics.import_report = Some(report.canonicalized());
}

fn degraded_object_diagnostic(
    status: &domain_types::ImportObjectStatus,
    sheet_idx: usize,
) -> Option<domain_types::ImportDiagnostic> {
    if status.recoverability == domain_types::ImportRecoverability::FullySupported {
        return None;
    }

    let mut reference = status.reference.clone().unwrap_or_default();
    if reference.part.is_none() {
        reference.part = Some(format!("sheet:{}", sheet_idx));
    }
    if reference.sheet_index.is_none() {
        reference.sheet_index = Some(sheet_idx as u32);
    }
    if reference.feature_kind.is_none() {
        reference.feature_kind = Some(status.feature_kind);
    }

    let code = diagnostic_code_for_status(status);
    let id = domain_types::deterministic_diagnostic_id(
        &code,
        reference.part.as_deref(),
        reference.relationship_id.as_deref(),
        None,
        None,
        reference
            .object_id
            .as_deref()
            .or(reference.object_name.as_deref()),
    );

    Some(domain_types::ImportDiagnostic {
        id,
        code,
        severity: diagnostic_severity_for_status(status),
        feature: status.feature_kind,
        recoverability: status.recoverability,
        message: diagnostic_message_for_status(status),
        reference: Some(reference),
    })
}

fn diagnostic_code_for_status(
    status: &domain_types::ImportObjectStatus,
) -> domain_types::ImportDiagnosticCode {
    match status.recoverability {
        domain_types::ImportRecoverability::SecurityDisabled => {
            domain_types::ImportDiagnosticCode::SecurityDisabledActiveContent
        }
        domain_types::ImportRecoverability::UnsupportedDropped
        | domain_types::ImportRecoverability::MalformedDropped => {
            domain_types::ImportDiagnosticCode::UnsupportedFeature
        }
        domain_types::ImportRecoverability::PartiallySupported
            if status.feature_kind == domain_types::ImportFeatureKind::OleObject =>
        {
            domain_types::ImportDiagnosticCode::MissingPart
        }
        _ if status.feature_kind == domain_types::ImportFeatureKind::Chart => {
            domain_types::ImportDiagnosticCode::ChartPartEmptySeries
        }
        _ => domain_types::ImportDiagnosticCode::UnsupportedFeature,
    }
}

fn diagnostic_severity_for_status(
    status: &domain_types::ImportObjectStatus,
) -> domain_types::ImportSeverity {
    match status.recoverability {
        domain_types::ImportRecoverability::MalformedDropped => domain_types::ImportSeverity::Error,
        _ => domain_types::ImportSeverity::Warning,
    }
}

fn diagnostic_message_for_status(status: &domain_types::ImportObjectStatus) -> String {
    match (status.feature_kind, status.recoverability) {
        (
            domain_types::ImportFeatureKind::Chart,
            domain_types::ImportRecoverability::PreservedNotRenderable,
        ) => "Imported chart was preserved but is not renderable".to_string(),
        (
            domain_types::ImportFeatureKind::FormControl,
            domain_types::ImportRecoverability::SecurityDisabled,
        ) => "Imported form control has disabled macro behavior".to_string(),
        (
            domain_types::ImportFeatureKind::FormControl,
            domain_types::ImportRecoverability::PreservedNotEditable,
        ) => "Imported form control was preserved as a non-editable object".to_string(),
        (
            domain_types::ImportFeatureKind::OleObject,
            domain_types::ImportRecoverability::SecurityDisabled,
        ) => "Imported linked OLE object was preserved with active linking disabled".to_string(),
        (
            domain_types::ImportFeatureKind::OleObject,
            domain_types::ImportRecoverability::UnsupportedPreserved,
        ) => "Imported embedded OLE object was preserved as a disabled placeholder".to_string(),
        (
            domain_types::ImportFeatureKind::OleObject,
            domain_types::ImportRecoverability::PartiallySupported,
        ) => "Imported OLE object is missing an owned embedded package payload".to_string(),
        _ => format!("Imported {:?} has degraded support", status.feature_kind),
    }
}

pub(super) fn append_import_compatibility_acknowledgements(
    sheets: &[FullParsedSheet],
    diagnostics: &mut ParseDiagnostics,
) {
    let diagram_count = count_ooxml_smartart_diagrams(sheets);
    let text_effect_count = count_ooxml_wordart_text_effects(sheets);

    if diagram_count == 0 && text_effect_count == 0 {
        return;
    }

    let mut report = diagnostics.clone().into_import_report();

    if diagram_count > 0 {
        let diagnostic = compatibility_acknowledgement(
            domain_types::ImportFeatureKind::Diagram,
            "ooxml-smartart",
            domain_types::ImportRecoverability::PartiallySupported,
            detected_count_message(
                diagram_count,
                "diagram",
                "diagrams",
                "OOXML SmartArt",
                "Diagram source metadata was preserved; editable Mog diagrams are not materialized yet.",
            ),
        );
        diagnostics
            .errors
            .push(domain_types::ParseError::from(diagnostic.clone()));
        report.diagnostics.push(diagnostic);
    }

    if text_effect_count > 0 {
        let diagnostic = compatibility_acknowledgement(
            domain_types::ImportFeatureKind::TextEffects,
            "ooxml-wordart",
            domain_types::ImportRecoverability::FullySupported,
            loaded_count_message(
                text_effect_count,
                "text-effect object",
                "text-effect objects",
                "OOXML WordArt",
            ),
        );
        diagnostics
            .errors
            .push(domain_types::ParseError::from(diagnostic.clone()));
        report.diagnostics.push(diagnostic);
    }

    diagnostics.import_report = Some(report.canonicalized());
}

fn compatibility_acknowledgement(
    feature: domain_types::ImportFeatureKind,
    source_id: &str,
    recoverability: domain_types::ImportRecoverability,
    message: String,
) -> domain_types::ImportDiagnostic {
    domain_types::ImportDiagnostic {
        id: domain_types::deterministic_diagnostic_id(
            &domain_types::ImportDiagnosticCode::CompatibilityAcknowledgement,
            None,
            None,
            None,
            None,
            Some(source_id),
        ),
        code: domain_types::ImportDiagnosticCode::CompatibilityAcknowledgement,
        severity: domain_types::ImportSeverity::Info,
        feature,
        recoverability,
        message,
        reference: Some(domain_types::ImportDiagnosticRef {
            feature_kind: Some(feature),
            object_id: Some(source_id.to_string()),
            ..domain_types::ImportDiagnosticRef::default()
        }),
    }
}

fn loaded_count_message(count: usize, singular: &str, plural: &str, source: &str) -> String {
    let noun = if count == 1 { singular } else { plural };
    format!("Loaded {count} {noun} from {source}.")
}

fn detected_count_message(
    count: usize,
    singular: &str,
    plural: &str,
    source: &str,
    caveat: &str,
) -> String {
    let noun = if count == 1 { singular } else { plural };
    format!("Detected {count} {noun} from {source}. {caveat}")
}

pub(super) fn count_ooxml_smartart_diagrams(sheets: &[FullParsedSheet]) -> usize {
    sheets
        .iter()
        .map(|sheet| sheet.smartart_diagrams.len())
        .sum()
}

pub(super) fn count_ooxml_wordart_text_effects(sheets: &[FullParsedSheet]) -> usize {
    sheets
        .iter()
        .filter_map(|sheet| sheet.parsed_drawing.as_ref())
        .flat_map(|drawing| drawing.anchors.iter())
        .map(|anchor| {
            let content = match anchor {
                crate::domain::drawings::Anchor::TwoCell(anchor) => &anchor.content,
                crate::domain::drawings::Anchor::OneCell(anchor) => &anchor.content,
                crate::domain::drawings::Anchor::Absolute(anchor) => &anchor.content,
            };
            count_wordart_text_effects_in_content(content)
        })
        .sum()
}

fn count_wordart_text_effects_in_content(
    content: &domain_types::domain::drawings::DrawingContent,
) -> usize {
    match content {
        domain_types::domain::drawings::DrawingContent::Shape(shape) => usize::from(
            shape
                .tx_body
                .as_ref()
                .and_then(|body| body.body_props.from_word_art)
                .unwrap_or(false),
        ),
        domain_types::domain::drawings::DrawingContent::GroupShape(group) => group
            .children
            .iter()
            .map(count_wordart_text_effects_in_content)
            .sum(),
        _ => 0,
    }
}
