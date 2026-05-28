use cell_types::{RangePos, SheetId};
use domain_types::domain::conditional_format::ConditionalFormat;

pub(super) fn resolve_format_ranges(
    format: &ConditionalFormat,
    resolve_cell_id: &impl Fn(&str, &str) -> Option<(u32, u32)>,
    fallback_sheet_id: Option<SheetId>,
) -> Option<Vec<RangePos>> {
    // Parse the sheet_id from the format, or use the fallback (caller's sheet context).
    // The fallback handles the common case where the parser leaves sheet_id empty
    // and the caller (refresh_cf_cache) already knows the sheet.
    let sheet_id = match SheetId::from_uuid_str(&format.sheet_id) {
        Ok(sid) => sid,
        Err(_) => match fallback_sheet_id {
            Some(sid) => sid,
            None => {
                tracing::warn!(
                    "CF format {} has invalid sheet_id '{}' and no fallback, skipping",
                    format.id,
                    format.sheet_id,
                );
                return None;
            }
        },
    };

    // Primary path: resolve range_identities via the closure
    let mut ranges: Vec<RangePos> = format
        .range_identities
        .as_ref()
        .map(|ris| {
            ris.iter()
                .filter_map(|r| {
                    let start = resolve_cell_id(&format.sheet_id, &r.top_left_cell_id)?;
                    let end = resolve_cell_id(&format.sheet_id, &r.bottom_right_cell_id)?;
                    Some(RangePos::new(
                        sheet_id,
                        start.0.min(end.0),
                        start.1.min(end.1),
                        start.0.max(end.0),
                        start.1.max(end.1),
                    ))
                })
                .collect()
        })
        .unwrap_or_default();

    // Fallback: if range_identities yielded nothing, use position-based ranges
    if ranges.is_empty() {
        ranges = format
            .ranges
            .iter()
            .map(|r| {
                RangePos::new(
                    sheet_id,
                    r.start_row(),
                    r.start_col(),
                    r.end_row(),
                    r.end_col(),
                )
            })
            .collect();
    }

    if ranges.is_empty() {
        tracing::debug!(
            "CF format {} has no valid ranges (neither range_identities nor ranges), skipping",
            format.id
        );
        return None;
    }

    Some(ranges)
}
