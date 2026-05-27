pub(super) const EMU_PER_CSS_PX: f64 = 9_525.0;

pub(super) fn px_to_emu(px: f64) -> i64 {
    (px * EMU_PER_CSS_PX).round() as i64
}

pub(super) fn emu_to_px(emu: f64) -> f64 {
    emu / EMU_PER_CSS_PX
}

fn json_number_to_i64(value: &serde_json::Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_f64().map(|v| v.round() as i64))
}

pub(super) fn json_i64_alias(
    obj: &serde_json::Map<String, serde_json::Value>,
    canonical: &str,
    legacy: &str,
) -> Option<i64> {
    obj.get(canonical)
        .and_then(json_number_to_i64)
        .or_else(|| obj.get(legacy).and_then(json_number_to_i64))
}
