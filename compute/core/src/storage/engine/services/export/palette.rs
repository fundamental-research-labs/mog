use domain_types::DocumentFormat;

/// Restore the exact import-time semantic snapshot for the immutable cell-XF
/// prefix before export.
///
/// Runtime Yrs stores palette entries as flat `CellFormat` values. Converting
/// those values back to `DocumentFormat` is intentionally semantic, not
/// lexically lossless (for example, baseline/default tokens can normalize
/// away). Those normalization differences are not edits. Imported style IDs
/// remain immutable, while all live edits allocate beyond this prefix, so the
/// lineage snapshot is the export authority for prefix entries.
pub(crate) fn rebind_imported_xf_prefix(
    palette: &mut [DocumentFormat],
    stylesheet: Option<&domain_types::WorkbookStylesheet>,
) -> usize {
    let Some(stylesheet) = stylesheet else {
        return 0;
    };
    let imported_len = stylesheet.cell_xf_lineage.len();
    if imported_len == 0
        || imported_len != stylesheet.cell_xfs.len()
        || palette.len() < imported_len
    {
        return 0;
    }
    palette[..imported_len].clone_from_slice(&stylesheet.cell_xf_lineage);
    imported_len
}

pub(crate) trait PaletteOps {
    /// Intern a generated/live format.
    ///
    /// Implementations deliberately exclude the immutable imported-XF prefix
    /// from semantic deduplication. A user edit that happens to equal an
    /// inherited imported XF is still an authored style and must not reacquire
    /// that XF's `apply*`/`xfId` lineage.
    fn get_or_insert(&self, fmt: DocumentFormat) -> u32;
}

pub(crate) struct LocalPalette {
    palette: std::cell::RefCell<Vec<DocumentFormat>>,
    index: std::cell::RefCell<rustc_hash::FxHashMap<DocumentFormat, u32>>,
}

impl LocalPalette {
    #[cfg(not(feature = "native"))]
    pub(super) fn new() -> Self {
        Self {
            palette: std::cell::RefCell::new(Vec::new()),
            index: std::cell::RefCell::new(rustc_hash::FxHashMap::default()),
        }
    }

    pub(crate) fn from_vec(existing: &mut Vec<DocumentFormat>) -> Self {
        Self::from_vec_with_imported_prefix(existing, 0)
    }

    pub(crate) fn from_vec_with_imported_prefix(
        existing: &mut Vec<DocumentFormat>,
        imported_prefix_len: usize,
    ) -> Self {
        if existing.is_empty() {
            existing.push(DocumentFormat::default());
        }
        let index = existing
            .iter()
            .enumerate()
            .skip(imported_prefix_len.min(existing.len()))
            .map(|(i, fmt)| (fmt.clone(), i as u32))
            .collect();
        Self {
            palette: std::cell::RefCell::new(std::mem::take(existing)),
            index: std::cell::RefCell::new(index),
        }
    }

    pub(crate) fn into_vec(self) -> Vec<DocumentFormat> {
        self.palette.into_inner()
    }
}

impl PaletteOps for LocalPalette {
    fn get_or_insert(&self, fmt: DocumentFormat) -> u32 {
        let mut index = self.index.borrow_mut();
        if let Some(&idx) = index.get(&fmt) {
            return idx;
        }
        let mut palette = self.palette.borrow_mut();
        let idx = palette.len() as u32;
        index.insert(fmt.clone(), idx);
        palette.push(fmt);
        idx
    }
}

#[cfg(feature = "native")]
pub(super) struct SharedPalette {
    inner: parking_lot::Mutex<(
        Vec<DocumentFormat>,
        rustc_hash::FxHashMap<DocumentFormat, u32>,
    )>,
}

#[cfg(feature = "native")]
impl SharedPalette {
    pub(super) fn from_vec_with_imported_prefix(
        existing: Vec<DocumentFormat>,
        imported_prefix_len: usize,
    ) -> Self {
        let mut existing = existing;
        if existing.is_empty() {
            existing.push(DocumentFormat::default());
        }
        let index = existing
            .iter()
            .enumerate()
            .skip(imported_prefix_len.min(existing.len()))
            .map(|(i, fmt)| (fmt.clone(), i as u32))
            .collect();
        Self {
            inner: parking_lot::Mutex::new((existing, index)),
        }
    }

    pub(super) fn into_vec(self) -> Vec<DocumentFormat> {
        self.inner.into_inner().0
    }
}

#[cfg(feature = "native")]
impl PaletteOps for SharedPalette {
    fn get_or_insert(&self, fmt: DocumentFormat) -> u32 {
        let mut guard = self.inner.lock();
        let (palette, index) = &mut *guard;
        if let Some(&idx) = index.get(&fmt) {
            return idx;
        }
        let idx = palette.len() as u32;
        index.insert(fmt.clone(), idx);
        palette.push(fmt);
        idx
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_formats_never_deduplicate_into_imported_prefix() {
        let imported = DocumentFormat {
            number_format: Some("0.00".to_string()),
            ..Default::default()
        };
        let mut entries = vec![DocumentFormat::default(), imported.clone()];
        let palette = LocalPalette::from_vec_with_imported_prefix(&mut entries, 2);

        assert_eq!(palette.get_or_insert(imported.clone()), 2);
        assert_eq!(palette.get_or_insert(imported), 2);
        assert_eq!(palette.into_vec().len(), 3);
    }

    #[test]
    fn imported_prefix_rebinds_to_exact_lineage_after_runtime_normalization() {
        let imported = DocumentFormat {
            number_format: Some("0.00".to_string()),
            ..Default::default()
        };
        let normalized = DocumentFormat {
            number_format: Some("0.00".to_string()),
            quote_prefix: Some(false),
            ..Default::default()
        };
        let raw_xf = ooxml_types::styles::CellXfDef::default();
        let stylesheet = domain_types::WorkbookStylesheet {
            cell_xfs: vec![raw_xf],
            cell_xf_lineage: vec![imported.clone()],
            ..Default::default()
        };
        let generated = DocumentFormat {
            number_format: Some("0%".to_string()),
            ..Default::default()
        };
        let mut palette = vec![normalized, generated.clone()];

        assert_eq!(
            rebind_imported_xf_prefix(&mut palette, Some(&stylesheet)),
            1
        );
        assert_eq!(palette, vec![imported, generated]);
    }
}
