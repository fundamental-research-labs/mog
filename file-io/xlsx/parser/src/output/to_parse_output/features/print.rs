use super::*;

// =============================================================================
// Domain conversions: Print settings
// =============================================================================

/// Convert parser `PrintSettingsOutput` into domain `PrintSettings`.
pub(crate) fn convert_print_settings(
    ps: &PrintSettingsOutput,
    sheet_relationships: &[ooxml_types::shared::OpcRelationship],
) -> PrintSettings {
    let margins = ps.margins.as_ref().map(|m| PageMargins {
        top: m.top,
        bottom: m.bottom,
        left: m.left,
        right: m.right,
        header: m.header,
        footer: m.footer,
    });
    let header_footer = ps.header_footer.as_ref().map(|hf| HeaderFooter {
        odd_header: hf.odd_header.clone(),
        odd_footer: hf.odd_footer.clone(),
        even_header: hf.even_header.clone(),
        even_footer: hf.even_footer.clone(),
        first_header: hf.first_header.clone(),
        first_footer: hf.first_footer.clone(),
        different_odd_even: hf.different_odd_even,
        different_first: hf.different_first,
        scale_with_doc: hf.scale_with_doc,
        align_with_margins: hf.align_with_margins,
    });
    // Only populate pageSetup-derived fields when the original XML actually
    // had a <pageSetup> element.  Without this guard, orientation defaults to
    // "default" (a non-empty string) which tricks `build_print_writer_from_domain`
    // into creating a spurious <pageSetup usePrinterDefaults="0"/>.
    let (
        orientation,
        scale,
        fit_to_width,
        fit_to_height,
        black_and_white,
        draft,
        first_page_number,
        paper_width,
        paper_height,
        copies,
    ) = if ps.has_page_setup {
        (
            non_empty(&ps.orientation),
            ps.scale.map(|s| s as u32),
            ps.fit_to_width.map(|f| f as u32),
            ps.fit_to_height.map(|f| f as u32),
            ps.black_and_white,
            ps.draft,
            ps.first_page_number,
            ps.paper_width.clone(),
            ps.paper_height.clone(),
            ps.copies,
        )
    } else {
        (None, None, None, None, false, false, None, None, None, None)
    };

    let mut settings = PrintSettings {
        paper_size: ps.paper_size,
        paper_width,
        paper_height,
        orientation,
        scale,
        fit_to_width,
        fit_to_height,
        gridlines: ps.grid_lines,
        headings: ps.headings,
        h_centered: ps.horizontal_centered,
        v_centered: ps.vertical_centered,
        grid_lines_set: ps.grid_lines_set,
        margins,
        header_footer,
        black_and_white,
        draft,
        first_page_number,
        page_order: ps.page_order.clone(),
        use_printer_defaults: ps.use_printer_defaults,
        horizontal_dpi: ps.horizontal_dpi,
        vertical_dpi: ps.vertical_dpi,
        r_id: ps.r_id.clone(),
        use_first_page_number: ps.use_first_page_number,
        has_print_options: ps.has_print_options,
        has_page_setup: ps.has_page_setup,
        copies,
        page_setup_properties: ps.page_setup_properties.as_ref().map(|props| {
            domain_types::PageSetupProperties {
                fit_to_page: props.fit_to_page,
                auto_page_breaks: props.auto_page_breaks,
            }
        }),
        cell_comments: ps.cell_comments.clone(),
        print_errors: ps.print_errors.clone(),
        imported_printer_settings: None,
    };
    settings.imported_printer_settings =
        imported_printer_settings_identity(&settings, sheet_relationships);
    settings
}

fn imported_printer_settings_identity(
    settings: &PrintSettings,
    sheet_relationships: &[ooxml_types::shared::OpcRelationship],
) -> Option<ImportedPrinterSettingsIdentity> {
    let relationship_id = settings.r_id.as_ref()?;
    let path = sheet_relationships
        .iter()
        .find(|rel| {
            rel.id == *relationship_id
                && rel.rel_type == crate::write::REL_PRINTER_SETTINGS
                && rel.target_mode.as_deref() != Some("External")
        })
        .map(|rel| crate::infra::opc::opc_target_to_zip_path(&rel.target, "xl/worksheets"))?;

    Some(ImportedPrinterSettingsIdentity {
        path: path.trim_start_matches('/').to_string(),
        relationship_id: Some(relationship_id.clone()),
        page_setup: PrinterSettingsPageSetupFingerprint::from_print_settings(settings),
    })
}

// =============================================================================
// Domain conversions: Page breaks
// =============================================================================

/// Convert parser `PageBreaksOutput` into domain `PageBreaks`.
pub(crate) fn convert_page_breaks(pb: &PageBreaksOutput) -> PageBreaks {
    use domain_types::domain::print::PageBreakEntry;
    PageBreaks {
        row_breaks: pb
            .row_breaks
            .iter()
            .map(|b| PageBreakEntry {
                id: b.id,
                min: b.min,
                max: b.max,
                manual: b.man,
                pt: b.pt,
            })
            .collect(),
        col_breaks: pb
            .col_breaks
            .iter()
            .map(|b| PageBreakEntry {
                id: b.id,
                min: b.min,
                max: b.max,
                manual: b.man,
                pt: b.pt,
            })
            .collect(),
    }
}

// =============================================================================
// Domain conversions: Header/footer images
// =============================================================================

/// Extract header/footer images from a sheet's raw VML drawings and resolve
/// image relationship IDs to file paths, producing domain `HeaderFooterImageInfo` entries.
pub(crate) fn convert_hf_images(
    sheet: &FullParsedSheet,
) -> Vec<domain_types::domain::print::HeaderFooterImageInfo> {
    use crate::domain::print::hf_images::{parse_hf_images_from_vml, parse_vml_rels_image_targets};
    use domain_types::domain::print::{HeaderFooterImageInfo, HfImagePosition};

    // Identify the comment VML path so we can skip it.
    let comment_vml_path: Option<String> = sheet.legacy_drawing_r_id.as_ref().and_then(|rid| {
        sheet
            .sheet_opc_rels
            .iter()
            .find(|r| r.id == *rid && r.rel_type == crate::infra::opc::REL_VML_DRAWING)
            .map(|r| opc_target_to_zip_path(&r.target, "xl"))
    });

    // Scan non-comment VML drawings for HF image shapes.
    for (path, data, rels) in &sheet.raw_vml_drawings {
        if comment_vml_path.as_deref() == Some(path.as_str()) {
            continue;
        }

        let images = parse_hf_images_from_vml(data);
        if images.is_empty() {
            continue;
        }

        // Parse .rels to get rel_id → target path mapping
        let rels_targets: Vec<(String, String)> = rels
            .as_ref()
            .map(|(_, rels_data)| parse_vml_rels_image_targets(rels_data))
            .unwrap_or_default();
        let rel_map: std::collections::HashMap<&str, &str> = rels_targets
            .iter()
            .map(|(id, target)| (id.as_str(), target.as_str()))
            .collect();

        // Map parser HeaderFooterImage → domain HeaderFooterImageInfo
        let hf_images: Vec<HeaderFooterImageInfo> = images
            .iter()
            .filter_map(|img| {
                let src = rel_map
                    .get(img.image_rel_id.as_str())
                    .map(|t| t.to_string())?;
                let position = match img.position {
                    crate::domain::print::HfImagePosition::LeftHeader => {
                        HfImagePosition::LeftHeader
                    }
                    crate::domain::print::HfImagePosition::CenterHeader => {
                        HfImagePosition::CenterHeader
                    }
                    crate::domain::print::HfImagePosition::RightHeader => {
                        HfImagePosition::RightHeader
                    }
                    crate::domain::print::HfImagePosition::LeftFooter => {
                        HfImagePosition::LeftFooter
                    }
                    crate::domain::print::HfImagePosition::CenterFooter => {
                        HfImagePosition::CenterFooter
                    }
                    crate::domain::print::HfImagePosition::RightFooter => {
                        HfImagePosition::RightFooter
                    }
                };
                Some(HeaderFooterImageInfo {
                    position,
                    src,
                    title: img.title.clone(),
                    width_pt: img.width_pt,
                    height_pt: img.height_pt,
                })
            })
            .collect();

        return hf_images;
    }

    Vec::new()
}
