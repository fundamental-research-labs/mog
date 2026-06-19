use super::super::formatting::extract_chart_line;
use super::super::series_sources::num_data_to_point_cache;

pub(super) fn extract_error_bars(
    err_bars: &[ooxml_types::charts::ErrorBars],
    uses_directional_error_bars: bool,
) -> (
    Option<domain_types::chart::ErrorBarData>,
    Option<domain_types::chart::ErrorBarData>,
    Option<domain_types::chart::ErrorBarData>,
) {
    let mut general = None;
    let mut x_bars = None;
    let mut y_bars = None;

    for eb in err_bars {
        let line_format = eb
            .sp_pr
            .as_ref()
            .and_then(|sp| sp.ln.as_ref())
            .map(extract_chart_line);
        let data = domain_types::chart::ErrorBarData {
            visible: Some(true),
            direction: eb.err_dir.as_ref().map(|d| d.to_ooxml().to_string()),
            bar_type: Some(eb.err_bar_type.to_ooxml().to_string()),
            value_type: Some(eb.err_val_type.to_ooxml().to_string()),
            value: eb.val,
            no_end_cap: eb.no_end_cap,
            line_format,
            plus_source: eb.plus.as_ref().map(num_data_source_to_error_bar_source),
            minus_source: eb.minus.as_ref().map(num_data_source_to_error_bar_source),
        };
        match (uses_directional_error_bars, eb.err_dir) {
            (_, Some(ooxml_types::charts::ErrorBarDirection::X)) => x_bars = Some(data),
            (true, Some(ooxml_types::charts::ErrorBarDirection::Y)) => y_bars = Some(data),
            (false, Some(ooxml_types::charts::ErrorBarDirection::Y)) | (_, None) => {
                general = Some(data);
            }
        }
    }

    (general, x_bars, y_bars)
}

fn num_data_source_to_error_bar_source(
    src: &ooxml_types::charts::NumDataSource,
) -> domain_types::chart::ErrorBarSourceData {
    use ooxml_types::charts::NumDataSource;

    match src {
        NumDataSource::Ref(num_ref) => domain_types::chart::ErrorBarSourceData {
            formula: Some(num_ref.f.clone()),
            cache: num_ref.num_cache.as_ref().map(num_data_to_point_cache),
        },
        NumDataSource::Lit(num_data) => domain_types::chart::ErrorBarSourceData {
            formula: None,
            cache: Some(num_data_to_point_cache(num_data)),
        },
    }
}
