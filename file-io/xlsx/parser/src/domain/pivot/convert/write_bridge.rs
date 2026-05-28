//! Read-model to writer-model bridge.
//!
//! The existing writer conversion module remains the emitting bridge during this
//! migration. This module records the explicit disposition contract for
//! read-side fields so unsupported structured write gaps are visible.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldDisposition {
    Emitted,
    FactsOnly,
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FieldDispositionEntry {
    pub field: &'static str,
    pub disposition: FieldDisposition,
}

pub const PIVOT_TABLE_FIELD_DISPOSITIONS: &[FieldDispositionEntry] = &[
    FieldDispositionEntry {
        field: "name",
        disposition: FieldDisposition::Emitted,
    },
    FieldDispositionEntry {
        field: "cache_id",
        disposition: FieldDisposition::Emitted,
    },
    FieldDispositionEntry {
        field: "data_on_rows",
        disposition: FieldDisposition::Emitted,
    },
    FieldDispositionEntry {
        field: "location",
        disposition: FieldDisposition::Emitted,
    },
    FieldDispositionEntry {
        field: "row_fields",
        disposition: FieldDisposition::Emitted,
    },
    FieldDispositionEntry {
        field: "col_fields",
        disposition: FieldDisposition::Emitted,
    },
    FieldDispositionEntry {
        field: "data_fields",
        disposition: FieldDisposition::Emitted,
    },
    FieldDispositionEntry {
        field: "page_fields",
        disposition: FieldDisposition::Emitted,
    },
    FieldDispositionEntry {
        field: "pivot_fields",
        disposition: FieldDisposition::Emitted,
    },
    FieldDispositionEntry {
        field: "style_info",
        disposition: FieldDisposition::Emitted,
    },
    FieldDispositionEntry {
        field: "grand_total_caption",
        disposition: FieldDisposition::Emitted,
    },
    FieldDispositionEntry {
        field: "row_header_caption",
        disposition: FieldDisposition::Emitted,
    },
    FieldDispositionEntry {
        field: "col_header_caption",
        disposition: FieldDisposition::Emitted,
    },
    FieldDispositionEntry {
        field: "row_grand_totals",
        disposition: FieldDisposition::Emitted,
    },
    FieldDispositionEntry {
        field: "col_grand_totals",
        disposition: FieldDisposition::Emitted,
    },
    FieldDispositionEntry {
        field: "grid_drop_zones",
        disposition: FieldDisposition::Emitted,
    },
    FieldDispositionEntry {
        field: "error_caption",
        disposition: FieldDisposition::Emitted,
    },
    FieldDispositionEntry {
        field: "show_error",
        disposition: FieldDisposition::Emitted,
    },
    FieldDispositionEntry {
        field: "missing_caption",
        disposition: FieldDisposition::Emitted,
    },
    FieldDispositionEntry {
        field: "show_missing",
        disposition: FieldDisposition::Emitted,
    },
];

pub const PIVOT_CACHE_FIELD_DISPOSITIONS: &[FieldDispositionEntry] = &[
    FieldDispositionEntry {
        field: "id",
        disposition: FieldDisposition::FactsOnly,
    },
    FieldDispositionEntry {
        field: "source_type",
        disposition: FieldDisposition::Emitted,
    },
    FieldDispositionEntry {
        field: "source_ref",
        disposition: FieldDisposition::Emitted,
    },
    FieldDispositionEntry {
        field: "source_sheet",
        disposition: FieldDisposition::Emitted,
    },
    FieldDispositionEntry {
        field: "fields",
        disposition: FieldDisposition::Emitted,
    },
    FieldDispositionEntry {
        field: "records",
        disposition: FieldDisposition::Emitted,
    },
    FieldDispositionEntry {
        field: "record_count",
        disposition: FieldDisposition::Emitted,
    },
    FieldDispositionEntry {
        field: "refresh_on_load",
        disposition: FieldDisposition::Emitted,
    },
];

pub fn pivot_table_field_dispositions() -> &'static [FieldDispositionEntry] {
    PIVOT_TABLE_FIELD_DISPOSITIONS
}

pub fn pivot_cache_field_dispositions() -> &'static [FieldDispositionEntry] {
    PIVOT_CACHE_FIELD_DISPOSITIONS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_top_level_read_field_has_a_writer_bridge_disposition() {
        let table_fields = [
            "name",
            "cache_id",
            "data_on_rows",
            "location",
            "row_fields",
            "col_fields",
            "data_fields",
            "page_fields",
            "pivot_fields",
            "style_info",
            "grand_total_caption",
            "row_header_caption",
            "col_header_caption",
            "row_grand_totals",
            "col_grand_totals",
            "grid_drop_zones",
            "error_caption",
            "show_error",
            "missing_caption",
            "show_missing",
        ];
        for field in table_fields {
            assert!(
                PIVOT_TABLE_FIELD_DISPOSITIONS
                    .iter()
                    .any(|entry| entry.field == field)
            );
        }

        let cache_fields = [
            "id",
            "source_type",
            "source_ref",
            "source_sheet",
            "fields",
            "records",
            "record_count",
            "refresh_on_load",
        ];
        for field in cache_fields {
            assert!(
                PIVOT_CACHE_FIELD_DISPOSITIONS
                    .iter()
                    .any(|entry| entry.field == field)
            );
        }
    }
}
