use crate::write::xml_writer::XmlWriter;

use super::{CalcMode, CalcSettings};

/// Convert `domain_types::CalculationProperties` into an `ooxml_types::CalcPr` for the workbook writer.
///
/// XLSX export policy: Mog never emits `xl/calcChain.xml`. Calc chains are an
/// Excel engine cache, not authoritative workbook state. Formula cached results
/// are emitted from modeled cell values, while workbook calculation flags remain
/// user/model-controlled settings.
pub fn calc_settings_from_domain(calc_props: &domain_types::CalculationProperties) -> CalcSettings {
    let ooxml_calc_pr: ooxml_types::workbook::CalcPr = calc_props.clone().into();
    ooxml_types::workbook::CalcPr {
        calc_id: Some(0),
        ..ooxml_calc_pr
    }
}

/// Write calcPr section.
///
/// Emits all OOXML CT_CalcPr attributes for full round-trip fidelity. Attributes
/// with spec-defined defaults are only emitted when they differ from the default.
pub(super) fn write_calc_settings(w: &mut XmlWriter, calc_settings: Option<&CalcSettings>) {
    let settings = calc_settings.cloned().unwrap_or_default();

    let calc_id = settings.calc_id.unwrap_or(0);
    w.start_element("calcPr").attr_num("calcId", calc_id);

    if settings.calc_mode != CalcMode::Auto {
        w.attr("calcMode", settings.calc_mode.to_ooxml());
    }
    if settings.full_calc_on_load {
        w.attr_bool("fullCalcOnLoad", true);
    }
    if settings.ref_mode != ooxml_types::workbook::RefMode::A1 {
        w.attr("refMode", settings.ref_mode.to_ooxml());
    }
    if settings.iterate {
        w.attr_bool("iterate", true);
    }
    if settings.iterate_count != 100 || settings.has_explicit_iterate_count {
        w.attr_num("iterateCount", settings.iterate_count);
    }
    if (settings.iterate_delta - 0.001).abs() > f64::EPSILON || settings.has_explicit_iterate_delta
    {
        w.attr_num("iterateDelta", settings.iterate_delta);
    }
    if !settings.full_precision {
        w.attr_bool("fullPrecision", false);
    }
    if !settings.calc_completed {
        w.attr_bool("calcCompleted", false);
    }
    if !settings.calc_on_save {
        w.attr_bool("calcOnSave", false);
    }
    if !settings.concurrent_calc {
        w.attr_bool("concurrentCalc", false);
    }
    if let Some(cmc) = settings.concurrent_manual_count {
        w.attr_num("concurrentManualCount", cmc);
    }
    if settings.force_full_calc {
        w.attr_bool("forceFullCalc", true);
    }

    w.self_close();
}
