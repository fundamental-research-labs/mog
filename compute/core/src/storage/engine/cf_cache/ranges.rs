use cell_types::{RangePos, SheetId};
use domain_types::domain::conditional_format::ConditionalFormat;

pub(super) fn resolve_format_ranges(
    format: &ConditionalFormat,
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

    let ranges: Vec<RangePos> = format
        .ranges
        .iter()
        .map(|range| {
            RangePos::new(
                sheet_id,
                range.start_row(),
                range.start_col(),
                range.end_row(),
                range.end_col(),
            )
        })
        .collect();

    if ranges.is_empty() {
        tracing::debug!("CF format {} has no ranges, skipping", format.id);
        return None;
    }

    Some(ranges)
}
