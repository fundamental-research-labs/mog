use super::cells::{
    SharedStringProvenanceCompaction, convert_cell_with_projection_role_and_provenance,
};
use crate::output::results::FullCellData;

/// Shared conversion policy for collected output and streamed native imports.
pub(crate) struct CellConversionContext<'a> {
    strings: &'a [String],
    rich_runs: &'a [Option<Vec<domain_types::RichTextRun>>],
    phonetic_xml: &'a [Option<Vec<u8>>],
    sst_compaction: Option<SharedStringProvenanceCompaction>,
    compact_numeric: bool,
    compact_cached_type: bool,
}

impl<'a> CellConversionContext<'a> {
    pub(crate) fn new(
        strings: &'a [String],
        rich_runs: &'a [Option<Vec<domain_types::RichTextRun>>],
        phonetic_xml: &'a [Option<Vec<u8>>],
    ) -> Self {
        Self {
            strings,
            rich_runs,
            phonetic_xml,
            sst_compaction: enabled("MOG_XLSX_COMPACT_SST_PROVENANCE").then(|| {
                SharedStringProvenanceCompaction::from_shared_strings(
                    strings,
                    rich_runs,
                    phonetic_xml,
                )
            }),
            compact_numeric: enabled("MOG_XLSX_COMPACT_NUMERIC_PROVENANCE"),
            compact_cached_type: enabled("MOG_XLSX_COMPACT_NON_FORMULA_CACHED_TYPE"),
        }
    }

    pub(crate) fn convert(
        &self,
        cell: &FullCellData,
        role: domain_types::ImportedCellProjectionRole,
    ) -> domain_types::CellData {
        convert_cell_with_projection_role_and_provenance(
            cell,
            self.strings,
            self.rich_runs,
            self.phonetic_xml,
            role,
            self.sst_compaction.as_ref(),
            self.compact_numeric,
            self.compact_cached_type,
        )
    }
}

fn enabled(name: &str) -> bool {
    std::env::var(name)
        .map(|value| {
            !matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "0" | "false" | "no" | "off"
            )
        })
        .unwrap_or(true)
}
