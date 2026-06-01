pub(in crate::domain::charts::read) fn chart_import_status_for_renderability(
    series: &[domain_types::chart::ChartSeriesData],
    data_range: Option<&str>,
    part_path: Option<&str>,
    object_name: Option<&str>,
) -> Option<domain_types::ImportObjectStatus> {
    if has_renderable_chart_data(series, data_range) {
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

fn has_renderable_chart_data(
    series: &[domain_types::chart::ChartSeriesData],
    data_range: Option<&str>,
) -> bool {
    data_range.is_some_and(|range| !range.trim().is_empty())
        || series.iter().any(series_has_renderable_value_dimension)
}

fn series_has_renderable_value_dimension(series: &domain_types::chart::ChartSeriesData) -> bool {
    series
        .values
        .as_deref()
        .is_some_and(|range| !range.trim().is_empty())
        || series
            .value_cache
            .as_ref()
            .is_some_and(point_cache_has_renderable_points)
}

fn point_cache_has_renderable_points(
    cache: &domain_types::chart::ChartSeriesPointCacheData,
) -> bool {
    match cache.point_count {
        Some(count) => count > 0,
        None => !cache.points.is_empty(),
    }
}

pub(in crate::domain::charts::read) fn chart_import_status_for_unsupported_chart_type(
    raw_chart_type: &str,
    part_path: Option<&str>,
    object_name: Option<&str>,
) -> Option<domain_types::ImportObjectStatus> {
    let token = raw_chart_type.trim();
    if token.is_empty() {
        return None;
    }

    Some(crate::domain::charts::chart_import_status_with_diagnostic(
        crate::domain::charts::ChartImportDiagnosticInput {
            code: domain_types::ImportDiagnosticCode::UnsupportedChartType,
            message: format!("Standard chart type `{token}` is not supported for rendering"),
            recoverability: domain_types::ImportRecoverability::PreservedNotRenderable,
            renderability: domain_types::ImportRenderability::NotRenderable,
            editability: domain_types::ImportEditability::PartiallyEditable,
            part_path,
            object_name,
            object_id: None,
        },
    ))
}

pub(in crate::domain::charts::read) fn chart_import_status_for_surface_family(
    _chart_type: &domain_types::ChartType,
    _wireframe: Option<bool>,
    _surface_top_view: Option<bool>,
    _part_path: Option<&str>,
    _object_name: Option<&str>,
) -> Option<domain_types::ImportObjectStatus> {
    // Surface charts are renderability-neutral here; data and unsupported-type
    // gates remain responsible for terminal import statuses.
    None
}

pub(in crate::domain::charts::read) fn merge_chart_import_statuses(
    primary: Option<domain_types::ImportObjectStatus>,
    secondary: Option<domain_types::ImportObjectStatus>,
) -> Option<domain_types::ImportObjectStatus> {
    match (primary, secondary) {
        (Some(mut primary), Some(secondary)) => {
            for diagnostic in secondary.diagnostics {
                if !primary
                    .diagnostics
                    .iter()
                    .any(|existing| existing.id == diagnostic.id)
                {
                    primary.diagnostics.push(diagnostic);
                }
            }
            Some(primary)
        }
        (Some(status), None) | (None, Some(status)) => Some(status),
        (None, None) => None,
    }
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
        OT::Bar3D => match config {
            CTC::Bar3D(c) => match c.bar_dir {
                BarDirection::Bar => domain_types::ChartType::Bar3D,
                BarDirection::Column => domain_types::ChartType::Column3D,
            },
            _ => domain_types::ChartType::Column3D,
        },
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn top_view_surface_family_is_renderable() {
        assert!(
            chart_import_status_for_surface_family(
                &domain_types::ChartType::Surface,
                None,
                Some(true),
                None,
                None,
            )
            .is_none()
        );
        assert!(
            chart_import_status_for_surface_family(
                &domain_types::ChartType::Surface,
                Some(true),
                Some(true),
                None,
                None,
            )
            .is_none()
        );
        assert!(
            chart_import_status_for_surface_family(
                &domain_types::ChartType::Surface3D,
                Some(true),
                Some(true),
                None,
                None,
            )
            .is_none()
        );
    }

    #[test]
    fn perspective_surface_family_is_renderable_as_projected_paths() {
        assert!(
            chart_import_status_for_surface_family(
                &domain_types::ChartType::Surface3D,
                None,
                Some(false),
                None,
                None,
            )
            .is_none()
        );
        assert!(
            chart_import_status_for_surface_family(
                &domain_types::ChartType::Surface3D,
                Some(true),
                Some(false),
                None,
                None,
            )
            .is_none()
        );
    }
}
