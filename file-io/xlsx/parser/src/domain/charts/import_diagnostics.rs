use domain_types::{
    ImportDiagnosticCode, ImportDiagnosticRef, ImportEditability, ImportFeatureKind,
    ImportObjectStatus, ImportRecoverability, ImportRenderability, ImportSource,
};

pub(crate) struct ChartImportDiagnosticInput<'a> {
    pub code: ImportDiagnosticCode,
    pub message: String,
    pub recoverability: ImportRecoverability,
    pub renderability: ImportRenderability,
    pub editability: ImportEditability,
    pub part_path: Option<&'a str>,
    pub object_name: Option<&'a str>,
    pub object_id: Option<&'a str>,
}

pub(crate) fn chart_import_status_with_diagnostic(
    input: ChartImportDiagnosticInput<'_>,
) -> ImportObjectStatus {
    let diagnostic_id = domain_types::deterministic_diagnostic_id(
        &input.code,
        input.part_path,
        None,
        None,
        None,
        input.object_id.or(input.object_name),
    );
    let reference = ImportDiagnosticRef {
        id: Some(diagnostic_id),
        code: Some(input.code),
        message: Some(input.message),
        part: input.part_path.map(str::to_string),
        object_name: input.object_name.map(str::to_string),
        object_id: input.object_id.map(str::to_string),
        feature_kind: Some(ImportFeatureKind::Chart),
        ..ImportDiagnosticRef::default()
    };

    ImportObjectStatus {
        source: ImportSource::Xlsx,
        feature_kind: ImportFeatureKind::Chart,
        recoverability: input.recoverability,
        renderability: input.renderability,
        editability: input.editability,
        diagnostics: vec![reference.clone()],
        reference: Some(reference),
    }
}
