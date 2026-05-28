use crate::transforms::bin::{histogram_with_series_config, resolve_bin_params};
use crate::types::PerSeriesBinConfig;

#[test]
fn resolve_bin_params_uses_chart_defaults_without_series_config() {
    let (maxbins, step, cumulative) = resolve_bin_params(None, Some(8), Some(2.0), Some(true));
    assert_eq!(maxbins, Some(8));
    assert_eq!(step, Some(2.0));
    assert!(cumulative);
}

#[test]
fn resolve_bin_params_series_config_overrides_chart_defaults() {
    let series = PerSeriesBinConfig {
        bin_count: Some(4),
        bin_width: Some(5.0),
        cumulative: Some(false),
    };

    let (maxbins, step, cumulative) =
        resolve_bin_params(Some(&series), Some(8), Some(2.0), Some(true));

    assert_eq!(maxbins, Some(4));
    assert_eq!(step, Some(5.0));
    assert!(!cumulative);
}

#[test]
fn resolve_bin_params_cumulative_defaults_to_false() {
    let (maxbins, step, cumulative) = resolve_bin_params(None, None, None, None);
    assert_eq!(maxbins, None);
    assert_eq!(step, None);
    assert!(!cumulative);
}

#[test]
fn histogram_with_series_config_returns_plain_histogram_bins() {
    let series = PerSeriesBinConfig {
        bin_count: Some(2),
        bin_width: Some(5.0),
        cumulative: Some(true),
    };
    let result = histogram_with_series_config(
        &[0.0, 5.0, 10.0],
        Some(&series),
        Some(10),
        None,
        None,
        Some(true),
    );
    let total: usize = result.iter().map(|bin| bin.count).sum();

    assert_eq!(total, 3);
    assert!(result.iter().all(|bin| bin.bin1 > bin.bin0));
}
