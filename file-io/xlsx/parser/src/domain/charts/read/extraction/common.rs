pub(in crate::domain::charts::read) fn chart_import_status_for_renderability(
    series: &[domain_types::chart::ChartSeriesData],
    data_range: Option<&str>,
    part_path: Option<&str>,
    object_name: Option<&str>,
) -> Option<domain_types::ImportObjectStatus> {
    if !series.is_empty() || data_range.is_some() {
        return None;
    }

    Some(crate::domain::charts::chart_import_status_with_diagnostic(
        crate::domain::charts::ChartImportDiagnosticInput {
            code: domain_types::ImportDiagnosticCode::ChartPartEmptySeries,
            message: "Imported chart was preserved but has no renderable series data".to_string(),
            recoverability: domain_types::ImportRecoverability::PreservedNotRenderable,
            renderability: domain_types::ImportRenderability::Placeholder,
            editability: domain_types::ImportEditability::PartiallyEditable,
            part_path,
            object_name,
            object_id: None,
        },
    ))
}

/// Map ooxml ChartType + config to domain ChartType.
pub(super) fn map_ooxml_chart_type_to_domain(
    ct: ooxml_types::charts::ChartType,
    config: &ooxml_types::charts::ChartTypeConfig,
) -> domain_types::ChartType {
    use ooxml_types::charts::{BarDirection, ChartType as OT, ChartTypeConfig as CTC};

    match ct {
        OT::Bar => match config {
            CTC::Bar(c) => match c.bar_dir {
                BarDirection::Bar => domain_types::ChartType::Bar,
                BarDirection::Column => domain_types::ChartType::Column,
            },
            _ => domain_types::ChartType::Column,
        },
        OT::Bar3D => domain_types::ChartType::Bar3D,
        OT::Line => domain_types::ChartType::Line,
        OT::Line3D => domain_types::ChartType::Line3D,
        OT::Pie => domain_types::ChartType::Pie,
        OT::Pie3D => domain_types::ChartType::Pie3D,
        OT::Doughnut => domain_types::ChartType::Doughnut,
        OT::Area => domain_types::ChartType::Area,
        OT::Area3D => domain_types::ChartType::Area3D,
        OT::Scatter => domain_types::ChartType::Scatter,
        OT::Bubble => domain_types::ChartType::Bubble,
        OT::Radar => domain_types::ChartType::Radar,
        OT::Stock => domain_types::ChartType::Stock,
        OT::Surface => domain_types::ChartType::Surface,
        OT::Surface3D => domain_types::ChartType::Surface3D,
        OT::OfPie => domain_types::ChartType::OfPie,
        OT::Combo => domain_types::ChartType::Combo,
        OT::Unknown => domain_types::ChartType::Unknown(String::new()),
    }
}
