//! Read/parse functions for worksheet domain features.
//!
//! Contains parsers for merge cells, frozen panes, sheet format properties,
//! column widths, row heights, and sheet view options extracted from worksheet XML.

use super::types::SheetFormatPrParsed;
use crate::infra::scanner;
use crate::infra::scanner::{extract_quoted_value, find_attr_simd, find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_bool_attr_opt, parse_string_attr, parse_u32_attr};
use crate::output::results::{ColWidth, MergeRange, Pane, PaneState, RowHeight, SheetPane};
use ooxml_types::worksheet::OutlineProperties;

// =============================================================================
// Merge Cells
// =============================================================================

/// Parse merge cells from worksheet XML.
///
/// Finds all `<mergeCell ref="..."/>` elements within the `<mergeCells>` section
/// and returns them as a vector of MergeRange.
///
/// # Arguments
/// * `xml` - The worksheet XML bytes
///
/// # Returns
/// A vector of MergeRange, one for each merge region found
pub fn parse_merge_cells(xml: &[u8]) -> Vec<MergeRange> {
    let mut merges = Vec::new();
    let mut pos = 0;

    // Find <mergeCells> section
    if let Some(section_start) = find_tag_simd(xml, b"mergeCells", 0) {
        let section_end =
            scanner::find_closing_tag(xml, b"mergeCells", section_start).unwrap_or(xml.len());
        let section = &xml[section_start..section_end];

        // Parse each <mergeCell> element
        while let Some(mc_start) = find_tag_simd(section, b"mergeCell", pos) {
            let element_end = find_gt_simd(section, mc_start)
                .map(|p| p + 1)
                .unwrap_or(section.len());
            let element = &section[mc_start..element_end];

            // Parse ref attribute
            if let Some(ref_pos) = find_attr_simd(element, b"ref=\"", 0) {
                let value_start = ref_pos + 5; // len of 'ref="'
                if let Some((start, end)) = extract_quoted_value(element, value_start) {
                    if let Ok(ref_str) = std::str::from_utf8(&element[start..end]) {
                        merges.push(MergeRange::from_ref(ref_str));
                    }
                }
            }

            pos = mc_start + 1;
        }
    }

    merges
}

// =============================================================================
// Sheet Properties
// =============================================================================

/// Parse `<sheetPr><outlinePr .../></sheetPr>` from worksheet XML.
pub fn parse_outline_properties(xml: &[u8]) -> Option<OutlineProperties> {
    let outline_start = find_tag_simd(xml, b"outlinePr", 0)?;
    let outline_end = find_gt_simd(xml, outline_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());
    let element = &xml[outline_start..outline_end];

    let mut props = OutlineProperties::default();
    if let Some(v) = parse_bool_attr_opt(element, b"applyStyles=\"") {
        props.apply_styles = v;
    }
    if let Some(v) = parse_bool_attr_opt(element, b"summaryBelow=\"") {
        props.summary_below = v;
    }
    if let Some(v) = parse_bool_attr_opt(element, b"summaryRight=\"") {
        props.summary_right = v;
    }
    if let Some(v) = parse_bool_attr_opt(element, b"showOutlineSymbols=\"") {
        props.show_outline_symbols = v;
    }

    Some(props)
}

// =============================================================================
// Frozen Panes
// =============================================================================

/// Parse pane settings from worksheet XML.
///
/// Looks for a `<pane>` element and extracts xSplit, ySplit, topLeftCell,
/// activePane, and state attributes per ECMA-376 CT_Pane (18.3.1.66).
///
/// # Arguments
/// * `xml` - The worksheet XML bytes
///
/// # Returns
/// Some(SheetPane) if a pane element is found, None otherwise
pub fn parse_frozen_pane(xml: &[u8]) -> Option<SheetPane> {
    // Look for <pane> element within <sheetViews>
    let pane_start = find_tag_simd(xml, b"pane", 0)?;
    let pane_end = find_gt_simd(xml, pane_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());
    let pane = &xml[pane_start..pane_end];

    // Parse state attribute
    let state = find_attr_simd(pane, b"state=\"", 0)
        .and_then(|pos| {
            let vs = pos + 7;
            extract_quoted_value(pane, vs).and_then(|(s, e)| std::str::from_utf8(&pane[s..e]).ok())
        })
        .map(PaneState::from_ooxml)
        .unwrap_or(PaneState::Split);

    // Parse xSplit (columns or twips)
    let x_split: f64 = find_attr_simd(pane, b"xSplit=\"", 0)
        .and_then(|pos| {
            let vs = pos + 8;
            extract_quoted_value(pane, vs)
                .and_then(|(s, e)| std::str::from_utf8(&pane[s..e]).ok()?.parse().ok())
        })
        .unwrap_or(0.0);

    // Parse ySplit (rows or twips)
    let y_split: f64 = find_attr_simd(pane, b"ySplit=\"", 0)
        .and_then(|pos| {
            let vs = pos + 8;
            extract_quoted_value(pane, vs)
                .and_then(|(s, e)| std::str::from_utf8(&pane[s..e]).ok()?.parse().ok())
        })
        .unwrap_or(0.0);

    // Parse topLeftCell
    let top_left_cell: Option<String> =
        find_attr_simd(pane, b"topLeftCell=\"", 0).and_then(|pos| {
            let vs = pos + 13;
            extract_quoted_value(pane, vs)
                .and_then(|(s, e)| std::str::from_utf8(&pane[s..e]).ok().map(|s| s.to_string()))
        });

    // Parse activePane
    let active_pane = find_attr_simd(pane, b"activePane=\"", 0)
        .and_then(|pos| {
            let vs = pos + 12;
            extract_quoted_value(pane, vs).and_then(|(s, e)| std::str::from_utf8(&pane[s..e]).ok())
        })
        .map(Pane::from_ooxml)
        .unwrap_or(Pane::TopLeft);

    Some(SheetPane::from_parsed(
        x_split,
        y_split,
        top_left_cell.as_deref(),
        active_pane,
        state,
    ))
}

// =============================================================================
// Column Widths and Row Heights
// =============================================================================

/// Parse the `<dimension ref="..."/>` element from the pre-sheetData region.
///
/// Returns the dimension as `(start_row, start_col, end_row, end_col)`, all 0-based,
/// or `None` if no dimension element is found.
pub fn parse_dimension_ref(xml: &[u8]) -> Option<(u32, u32, u32, u32)> {
    let pos = find_tag_simd(xml, b"dimension", 0)?;
    let end = find_gt_simd(xml, pos).map(|p| p + 1).unwrap_or(xml.len());
    let elem = &xml[pos..end];
    let attr_pos = find_attr_simd(elem, b"ref=\"", 0)?;
    let value_start = attr_pos + b"ref=\"".len();
    let (s, e) = extract_quoted_value(elem, value_start)?;
    let ref_str = std::str::from_utf8(&elem[s..e]).ok()?;
    crate::infra::a1::parse_a1_range(ref_str)
}

pub fn parse_sheet_format_pr(xml: &[u8]) -> SheetFormatPrParsed {
    let mut default_row_height = None;
    let mut default_col_width = None;
    let mut base_col_width = None;
    let mut default_row_descent = None;
    let mut outline_level_row = None;
    let mut outline_level_col = None;
    let mut custom_height = false;

    if let Some(tag_start) = find_tag_simd(xml, b"sheetFormatPr", 0) {
        let tag_end = find_gt_simd(xml, tag_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let elem = &xml[tag_start..tag_end];

        default_row_height = find_attr_simd(elem, b"defaultRowHeight=\"", 0).and_then(|p| {
            let vs = p + 18;
            extract_quoted_value(elem, vs)
                .and_then(|(s, e)| std::str::from_utf8(&elem[s..e]).ok()?.parse().ok())
        });

        default_col_width = find_attr_simd(elem, b"defaultColWidth=\"", 0).and_then(|p| {
            let vs = p + 17;
            extract_quoted_value(elem, vs)
                .and_then(|(s, e)| std::str::from_utf8(&elem[s..e]).ok()?.parse().ok())
        });

        base_col_width = find_attr_simd(elem, b"baseColWidth=\"", 0).and_then(|p| {
            let vs = p + 14; // len of b"baseColWidth=\""
            extract_quoted_value(elem, vs)
                .and_then(|(s, e)| std::str::from_utf8(&elem[s..e]).ok()?.parse().ok())
        });

        outline_level_row = find_attr_simd(elem, b"outlineLevelRow=\"", 0).and_then(|p| {
            let vs = p + 17; // len of b"outlineLevelRow=\""
            extract_quoted_value(elem, vs)
                .and_then(|(s, e)| std::str::from_utf8(&elem[s..e]).ok()?.parse().ok())
        });

        outline_level_col = find_attr_simd(elem, b"outlineLevelCol=\"", 0).and_then(|p| {
            let vs = p + 17; // len of b"outlineLevelCol=\""
            extract_quoted_value(elem, vs)
                .and_then(|(s, e)| std::str::from_utf8(&elem[s..e]).ok()?.parse().ok())
        });

        // Try x14ac:dyDescent="..." first (find_attr_simd checks whitespace-preceding,
        // so the full qualified attribute name is needed), then fall back to bare dyDescent="..."
        default_row_descent = find_attr_simd(elem, b"x14ac:dyDescent=\"", 0)
            .and_then(|p| {
                let vs = p + 18; // len of b"x14ac:dyDescent=\""
                extract_quoted_value(elem, vs)
                    .and_then(|(s, e)| std::str::from_utf8(&elem[s..e]).ok()?.parse().ok())
            })
            .or_else(|| {
                find_attr_simd(elem, b"dyDescent=\"", 0).and_then(|p| {
                    let vs = p + 11; // len of b"dyDescent=\""
                    extract_quoted_value(elem, vs)
                        .and_then(|(s, e)| std::str::from_utf8(&elem[s..e]).ok()?.parse().ok())
                })
            });

        custom_height = find_attr_simd(elem, b"customHeight=\"1\"", 0).is_some()
            || find_attr_simd(elem, b"customHeight=\"true\"", 0).is_some();
    }

    let zero_height = if let Some(tag_start) = find_tag_simd(xml, b"sheetFormatPr", 0) {
        let tag_end = find_gt_simd(xml, tag_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let elem = &xml[tag_start..tag_end];
        find_attr_simd(elem, b"zeroHeight=\"1\"", 0).is_some()
            || find_attr_simd(elem, b"zeroHeight=\"true\"", 0).is_some()
    } else {
        false
    };

    SheetFormatPrParsed {
        default_row_height,
        default_col_width,
        base_col_width,
        default_row_descent,
        outline_level_row,
        outline_level_col,
        custom_height,
        zero_height,
    }
}

/// Parse column widths from the `<cols>` section of worksheet XML.
///
/// This only scans the `<cols>` section (which appears before `<sheetData>`),
/// not the row elements. Use this when row heights are already extracted
/// by the cell parser.
pub fn parse_col_widths(xml: &[u8]) -> Vec<ColWidth> {
    let mut col_widths = Vec::new();

    // Parse <cols> section
    if let Some(cols_start) = find_tag_simd(xml, b"cols", 0) {
        let cols_end = scanner::find_closing_tag(xml, b"cols", cols_start).unwrap_or(xml.len());
        let cols_section = &xml[cols_start..cols_end];

        let mut pos = 0;
        while let Some(col_start) = find_tag_simd(cols_section, b"col", pos) {
            let col_end = find_gt_simd(cols_section, col_start)
                .map(|p| p + 1)
                .unwrap_or(cols_section.len());
            let col_elem = &cols_section[col_start..col_end];

            let min = find_attr_simd(col_elem, b"min=\"", 0)
                .and_then(|p| {
                    let vs = p + 5;
                    extract_quoted_value(col_elem, vs).and_then(|(s, e)| {
                        std::str::from_utf8(&col_elem[s..e])
                            .ok()?
                            .parse::<u32>()
                            .ok()
                    })
                })
                .unwrap_or(1);

            let max = find_attr_simd(col_elem, b"max=\"", 0)
                .and_then(|p| {
                    let vs = p + 5;
                    extract_quoted_value(col_elem, vs).and_then(|(s, e)| {
                        std::str::from_utf8(&col_elem[s..e])
                            .ok()?
                            .parse::<u32>()
                            .ok()
                    })
                })
                .unwrap_or(min);

            let width = find_attr_simd(col_elem, b"width=\"", 0)
                .and_then(|p| {
                    let vs = p + 7;
                    extract_quoted_value(col_elem, vs)
                        .and_then(|(s, e)| std::str::from_utf8(&col_elem[s..e]).ok()?.parse().ok())
                })
                .unwrap_or(8.43);

            let style: Option<u32> = find_attr_simd(col_elem, b"style=\"", 0).and_then(|p| {
                let vs = p + 7; // len of 'style="'
                extract_quoted_value(col_elem, vs).and_then(|(s, e)| {
                    std::str::from_utf8(&col_elem[s..e])
                        .ok()?
                        .parse::<u32>()
                        .ok()
                })
            });

            let hidden = find_attr_simd(col_elem, b"hidden=\"", 0)
                .and_then(|p| {
                    let vs = p + 8; // len of 'hidden="'
                    extract_quoted_value(col_elem, vs).and_then(|(s, e)| {
                        std::str::from_utf8(&col_elem[s..e])
                            .ok()
                            .map(|v| v == "1" || v == "true")
                    })
                })
                .unwrap_or(false);

            let custom_width = find_attr_simd(col_elem, b"customWidth=\"", 0)
                .and_then(|p| {
                    let vs = p + 13;
                    extract_quoted_value(col_elem, vs).and_then(|(s, e)| {
                        std::str::from_utf8(&col_elem[s..e])
                            .ok()
                            .map(|v| v == "1" || v == "true")
                    })
                })
                .unwrap_or(false);

            let best_fit = find_attr_simd(col_elem, b"bestFit=\"", 0)
                .and_then(|p| {
                    let vs = p + 9; // len of b"bestFit=\""
                    extract_quoted_value(col_elem, vs).and_then(|(s, e)| {
                        std::str::from_utf8(&col_elem[s..e])
                            .ok()
                            .map(|v| v == "1" || v == "true")
                    })
                })
                .unwrap_or(false);

            let outline_level: Option<u8> = find_attr_simd(col_elem, b"outlineLevel=\"", 0)
                .and_then(|p| {
                    let vs = p + 14; // len of b"outlineLevel=\""
                    extract_quoted_value(col_elem, vs)
                        .and_then(|(s, e)| std::str::from_utf8(&col_elem[s..e]).ok()?.parse().ok())
                });

            let collapsed = find_attr_simd(col_elem, b"collapsed=\"", 0)
                .and_then(|p| {
                    let vs = p + 11; // len of b"collapsed=\""
                    extract_quoted_value(col_elem, vs).and_then(|(s, e)| {
                        std::str::from_utf8(&col_elem[s..e])
                            .ok()
                            .map(|v| v == "1" || v == "true")
                    })
                })
                .unwrap_or(false);

            // Preserve the original min/max range as a single ColWidth entry.
            // Expanding into individual entries loses range information and causes
            // round-trip diffs (e.g. `min="8" max="10"` becomes three separate elements).
            let mut cw = ColWidth::range(min, max, width);
            if let Some(s) = style {
                cw = cw.with_style(s);
            }
            if hidden {
                cw = cw.with_hidden(true);
            }
            if custom_width {
                cw.custom_width = true;
            }
            if best_fit {
                cw.best_fit = true;
            }
            cw.outline_level = outline_level;
            cw.collapsed = collapsed;
            col_widths.push(cw);

            pos = col_end;
        }
    }

    col_widths
}

/// Parse column widths and row heights from worksheet XML.
///
/// Parses the `<cols>` section for column widths and `<row>` elements
/// with `ht` attributes for row heights.
///
/// # Arguments
/// * `xml` - The worksheet XML bytes
///
/// # Returns
/// A tuple of (column_widths, row_heights) vectors
pub fn parse_dimensions(xml: &[u8]) -> (Vec<ColWidth>, Vec<RowHeight>) {
    let mut col_widths = Vec::new();
    let mut row_heights = Vec::new();

    // Parse <cols> section
    if let Some(cols_start) = find_tag_simd(xml, b"cols", 0) {
        let cols_end = scanner::find_closing_tag(xml, b"cols", cols_start).unwrap_or(xml.len());
        let cols_section = &xml[cols_start..cols_end];

        let mut pos = 0;
        while let Some(col_start) = find_tag_simd(cols_section, b"col", pos) {
            let col_end = find_gt_simd(cols_section, col_start)
                .map(|p| p + 1)
                .unwrap_or(cols_section.len());
            let col_elem = &cols_section[col_start..col_end];

            // Parse min and max (column range)
            let min = find_attr_simd(col_elem, b"min=\"", 0)
                .and_then(|p| {
                    let vs = p + 5;
                    extract_quoted_value(col_elem, vs).and_then(|(s, e)| {
                        std::str::from_utf8(&col_elem[s..e])
                            .ok()?
                            .parse::<u32>()
                            .ok()
                    })
                })
                .unwrap_or(1);

            let max = find_attr_simd(col_elem, b"max=\"", 0)
                .and_then(|p| {
                    let vs = p + 5;
                    extract_quoted_value(col_elem, vs).and_then(|(s, e)| {
                        std::str::from_utf8(&col_elem[s..e])
                            .ok()?
                            .parse::<u32>()
                            .ok()
                    })
                })
                .unwrap_or(min);

            // Parse width
            let width = find_attr_simd(col_elem, b"width=\"", 0)
                .and_then(|p| {
                    let vs = p + 7;
                    extract_quoted_value(col_elem, vs)
                        .and_then(|(s, e)| std::str::from_utf8(&col_elem[s..e]).ok()?.parse().ok())
                })
                .unwrap_or(8.43); // Default Excel column width

            // Add widths for column range (convert to 0-based)
            let style: Option<u32> = find_attr_simd(col_elem, b"style=\"", 0).and_then(|p| {
                let vs = p + 7; // len of 'style="'
                extract_quoted_value(col_elem, vs).and_then(|(s, e)| {
                    std::str::from_utf8(&col_elem[s..e])
                        .ok()?
                        .parse::<u32>()
                        .ok()
                })
            });

            let hidden = find_attr_simd(col_elem, b"hidden=\"", 0)
                .and_then(|p| {
                    let vs = p + 8; // len of 'hidden="'
                    extract_quoted_value(col_elem, vs).and_then(|(s, e)| {
                        std::str::from_utf8(&col_elem[s..e])
                            .ok()
                            .map(|v| v == "1" || v == "true")
                    })
                })
                .unwrap_or(false);

            let custom_width = find_attr_simd(col_elem, b"customWidth=\"", 0)
                .and_then(|p| {
                    let vs = p + 13;
                    extract_quoted_value(col_elem, vs).and_then(|(s, e)| {
                        std::str::from_utf8(&col_elem[s..e])
                            .ok()
                            .map(|v| v == "1" || v == "true")
                    })
                })
                .unwrap_or(false);

            let best_fit = find_attr_simd(col_elem, b"bestFit=\"", 0)
                .and_then(|p| {
                    let vs = p + 9; // len of b"bestFit=\""
                    extract_quoted_value(col_elem, vs).and_then(|(s, e)| {
                        std::str::from_utf8(&col_elem[s..e])
                            .ok()
                            .map(|v| v == "1" || v == "true")
                    })
                })
                .unwrap_or(false);

            let outline_level: Option<u8> = find_attr_simd(col_elem, b"outlineLevel=\"", 0)
                .and_then(|p| {
                    let vs = p + 14;
                    extract_quoted_value(col_elem, vs)
                        .and_then(|(s, e)| std::str::from_utf8(&col_elem[s..e]).ok()?.parse().ok())
                });

            let collapsed = find_attr_simd(col_elem, b"collapsed=\"", 0)
                .and_then(|p| {
                    let vs = p + 11;
                    extract_quoted_value(col_elem, vs).and_then(|(s, e)| {
                        std::str::from_utf8(&col_elem[s..e])
                            .ok()
                            .map(|v| v == "1" || v == "true")
                    })
                })
                .unwrap_or(false);

            // Preserve the original min/max range as a single ColWidth entry.
            let mut cw = ColWidth::range(min, max, width);
            if let Some(s) = style {
                cw = cw.with_style(s);
            }
            if hidden {
                cw = cw.with_hidden(true);
            }
            if custom_width {
                cw.custom_width = true;
            }
            if best_fit {
                cw.best_fit = true;
            }
            cw.outline_level = outline_level;
            cw.collapsed = collapsed;
            col_widths.push(cw);

            pos = col_end;
        }
    }

    // Parse row attributes from <row> elements (height, hidden, style, etc.)
    let mut pos = 0;
    while let Some(row_start) = find_tag_simd(xml, b"row", pos) {
        let row_end = find_gt_simd(xml, row_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let row_elem = &xml[row_start..row_end];

        // Parse row number
        let row_num = find_attr_simd(row_elem, b"r=\"", 0).and_then(|p| {
            let vs = p + 3;
            extract_quoted_value(row_elem, vs).and_then(|(s, e)| {
                std::str::from_utf8(&row_elem[s..e])
                    .ok()?
                    .parse::<u32>()
                    .ok()
            })
        });

        // Parse height (preserve original string for round-trip fidelity)
        let (height, height_str): (Option<f64>, Option<String>) =
            match find_attr_simd(row_elem, b"ht=\"", 0) {
                Some(p) => {
                    let vs = p + 4;
                    match extract_quoted_value(row_elem, vs) {
                        Some((s, e)) => {
                            let raw = std::str::from_utf8(&row_elem[s..e]).ok();
                            let val = raw.and_then(|r| r.parse::<f64>().ok());
                            (val, raw.map(|r| r.to_string()))
                        }
                        None => (None, None),
                    }
                }
                None => (None, None),
            };

        let has_custom_height = find_attr_simd(row_elem, b"customHeight=\"1\"", 0).is_some();
        // Parse hidden with any value ("0", "1", "true", "false") for round-trip fidelity
        let hidden_val: Option<bool> = find_attr_simd(row_elem, b"hidden=\"", 0).and_then(|p| {
            let vs = p + 8; // len of b"hidden=\""
            extract_quoted_value(row_elem, vs).and_then(|(s, e)| match &row_elem[s..e] {
                b"1" | b"true" => Some(true),
                b"0" | b"false" => Some(false),
                _ => None,
            })
        });
        let has_thick_top = find_attr_simd(row_elem, b"thickTop=\"1\"", 0).is_some();
        let has_thick_bot = find_attr_simd(row_elem, b"thickBot=\"1\"", 0).is_some();
        // Parse collapsed with any value ("0", "1", "true", "false") for round-trip fidelity
        let collapsed_val: Option<bool> =
            find_attr_simd(row_elem, b"collapsed=\"", 0).and_then(|p| {
                let vs = p + 11; // len of b"collapsed=\""
                extract_quoted_value(row_elem, vs).and_then(|(s, e)| match &row_elem[s..e] {
                    b"1" | b"true" => Some(true),
                    b"0" | b"false" => Some(false),
                    _ => None,
                })
            });
        let outline_level: Option<u8> =
            find_attr_simd(row_elem, b"outlineLevel=\"", 0).and_then(|p| {
                let vs = p + 14; // len of b"outlineLevel=\""
                extract_quoted_value(row_elem, vs)
                    .and_then(|(s, e)| std::str::from_utf8(&row_elem[s..e]).ok()?.parse().ok())
            });
        let has_custom_format = find_attr_simd(row_elem, b"customFormat=\"1\"", 0).is_some();
        let style: Option<u32> = if has_custom_format {
            find_attr_simd(row_elem, b"s=\"", 0).and_then(|p| {
                let vs = p + 3; // len of b"s=\""
                extract_quoted_value(row_elem, vs)
                    .and_then(|(s, e)| std::str::from_utf8(&row_elem[s..e]).ok()?.parse().ok())
            })
        } else {
            None
        };

        let has_attrs = height.is_some()
            || has_custom_height
            || hidden_val.is_some()
            || collapsed_val.is_some()
            || has_thick_top
            || has_thick_bot
            || outline_level.is_some()
            || style.is_some()
            || has_custom_format;

        if let (Some(row), true) = (row_num, has_attrs) {
            let mut rh = RowHeight::new(row - 1, height.unwrap_or(0.0)); // Convert to 0-based
            rh.height_str = height_str;
            rh.custom_height = has_custom_height;
            rh.hidden = hidden_val;
            rh.thick_top = has_thick_top;
            rh.thick_bot = has_thick_bot;
            rh.collapsed = collapsed_val;
            rh.outline_level = outline_level;
            rh.custom_format = has_custom_format;
            rh.style = style;
            row_heights.push(rh);
        }

        pos = row_end;
    }

    (col_widths, row_heights)
}

// =============================================================================
// Sheet View
// =============================================================================

/// Parse all sheet view options from worksheet XML.
///
/// Extracts all `<sheetView>` elements within `<sheetViews>` and returns
/// them as a Vec for round-trip fidelity.
///
/// Returns an empty Vec when no `<sheetView>` elements are found.
pub fn parse_sheet_views(xml: &[u8]) -> Vec<ooxml_types::worksheet::SheetView> {
    use crate::infra::xml::{parse_string_attr, parse_u32_attr};
    use ooxml_types::worksheet::{Selection, SheetView, SheetViewType};

    let mut views = Vec::new();
    let mut search_offset: usize = 0;

    while let Some(view_start) = find_tag_simd(xml, b"sheetView", search_offset) {
        // Make sure this is <sheetView not <sheetViews
        let after_tag = view_start + b"<sheetView".len();
        if after_tag < xml.len() && xml[after_tag] == b's' {
            search_offset = after_tag;
            continue;
        }

        let view_end = match find_gt_simd(xml, view_start) {
            Some(p) => p,
            None => break,
        };
        let element = &xml[view_start..view_end + 1];

        let mut sv = SheetView::default();

        // Boolean attributes
        if let Some(v) = parse_bool_attr_opt(element, b"showGridLines=\"") {
            sv.show_grid_lines = v;
        }
        if let Some(v) = parse_bool_attr_opt(element, b"showRowColHeaders=\"") {
            sv.show_row_col_headers = v;
        }
        if let Some(v) = parse_bool_attr_opt(element, b"showFormulas=\"") {
            sv.show_formulas = v;
        }
        if let Some(v) = parse_bool_attr_opt(element, b"showZeros=\"") {
            sv.show_zeros = v;
        }
        if let Some(v) = parse_bool_attr_opt(element, b"tabSelected=\"") {
            sv.tab_selected = v;
        }
        if let Some(v) = parse_bool_attr_opt(element, b"rightToLeft=\"") {
            sv.right_to_left = v;
        }
        if let Some(v) = parse_bool_attr_opt(element, b"showRuler=\"") {
            sv.show_ruler = v;
        }
        if let Some(v) = parse_bool_attr_opt(element, b"showOutlineSymbols=\"") {
            sv.show_outline_symbols = v;
        }
        if let Some(v) = parse_bool_attr_opt(element, b"showWhiteSpace=\"") {
            sv.show_white_space = v;
        }
        if let Some(v) = parse_bool_attr_opt(element, b"windowProtection=\"") {
            sv.window_protection = v;
        }
        if let Some(v) = parse_bool_attr_opt(element, b"defaultGridColor=\"") {
            sv.default_grid_color = v;
        }

        // String / enum attributes
        if let Some(v) = parse_string_attr(element, b"topLeftCell=\"") {
            if !v.is_empty() {
                sv.top_left_cell = Some(v);
            }
        }
        if let Some(v) = parse_string_attr(element, b"view=\"") {
            sv.view = SheetViewType::from_ooxml(&v);
        }

        // Numeric attributes
        if let Some(v) = parse_u32_attr(element, b"zoomScale=\"") {
            sv.zoom_scale = v;
        }
        if let Some(v) = parse_u32_attr(element, b"zoomScaleNormal=\"") {
            sv.zoom_scale_normal = v;
        }
        if let Some(v) = parse_u32_attr(element, b"zoomScalePageLayoutView=\"") {
            sv.zoom_scale_page_layout_view = Some(v);
        }
        if let Some(v) = parse_u32_attr(element, b"zoomScaleSheetLayoutView=\"") {
            sv.zoom_scale_sheet_layout_view = Some(v);
        }
        if let Some(v) = parse_u32_attr(element, b"workbookViewId=\"") {
            sv.workbook_view_id = v;
        }
        if let Some(v) = parse_u32_attr(element, b"colorId=\"") {
            sv.color_id = v;
        }

        // Parse child elements (<pane> and <selection>) within the <sheetView> block.
        // If the tag is self-closing (ends with "/>"), there are no children to parse.
        let is_self_closing = view_end > 0 && xml[view_end - 1] == b'/';
        let (block, sheetview_block_end) = if is_self_closing {
            // Self-closing tag — empty block, no children
            (&xml[view_end + 1..view_end + 1], view_end + 1)
        } else {
            let end = scanner::find_closing_tag(xml, b"sheetView", view_start).unwrap_or(xml.len());
            (&xml[view_end + 1..end], end)
        };

        // Parse <pane> child element (if present).
        sv.pane = {
            if let Some(pane_start) = find_tag_simd(block, b"pane", 0) {
                let pane_end = find_gt_simd(block, pane_start)
                    .map(|p| p + 1)
                    .unwrap_or(block.len());
                let pane_elem = &block[pane_start..pane_end];

                let state = find_attr_simd(pane_elem, b"state=\"", 0)
                    .and_then(|pos| {
                        let vs = pos + 7;
                        extract_quoted_value(pane_elem, vs)
                            .and_then(|(s, e)| std::str::from_utf8(&pane_elem[s..e]).ok())
                    })
                    .map(crate::output::results::PaneState::from_ooxml)
                    .unwrap_or(crate::output::results::PaneState::Split);

                let x_split: f64 = find_attr_simd(pane_elem, b"xSplit=\"", 0)
                    .and_then(|pos| {
                        let vs = pos + 8;
                        extract_quoted_value(pane_elem, vs).and_then(|(s, e)| {
                            std::str::from_utf8(&pane_elem[s..e]).ok()?.parse().ok()
                        })
                    })
                    .unwrap_or(0.0);

                let y_split: f64 = find_attr_simd(pane_elem, b"ySplit=\"", 0)
                    .and_then(|pos| {
                        let vs = pos + 8;
                        extract_quoted_value(pane_elem, vs).and_then(|(s, e)| {
                            std::str::from_utf8(&pane_elem[s..e]).ok()?.parse().ok()
                        })
                    })
                    .unwrap_or(0.0);

                let top_left_cell: Option<String> = find_attr_simd(pane_elem, b"topLeftCell=\"", 0)
                    .and_then(|pos| {
                        let vs = pos + 13;
                        extract_quoted_value(pane_elem, vs).and_then(|(s, e)| {
                            std::str::from_utf8(&pane_elem[s..e])
                                .ok()
                                .map(|s| s.to_string())
                        })
                    });

                let active_pane = find_attr_simd(pane_elem, b"activePane=\"", 0)
                    .and_then(|pos| {
                        let vs = pos + 12;
                        extract_quoted_value(pane_elem, vs)
                            .and_then(|(s, e)| std::str::from_utf8(&pane_elem[s..e]).ok())
                    })
                    .map(crate::output::results::Pane::from_ooxml)
                    .unwrap_or(crate::output::results::Pane::TopLeft);

                Some(ooxml_types::worksheet::SheetPane::from_parsed(
                    x_split,
                    y_split,
                    top_left_cell.as_deref(),
                    active_pane,
                    state,
                ))
            } else {
                None
            }
        };

        // Parse <selection> child elements (0 or more).
        {
            let mut pos = 0;
            while let Some(sel_start) = find_tag_simd(block, b"selection", pos) {
                let sel_end = find_gt_simd(block, sel_start)
                    .map(|p| p + 1)
                    .unwrap_or(block.len());
                let sel_elem = &block[sel_start..sel_end];

                let pane = find_attr_simd(sel_elem, b"pane=\"", 0)
                    .and_then(|p| {
                        let vs = p + 6;
                        extract_quoted_value(sel_elem, vs)
                            .and_then(|(s, e)| std::str::from_utf8(&sel_elem[s..e]).ok())
                    })
                    .map(|s| crate::output::results::Pane::from_ooxml(s));

                let active_cell = find_attr_simd(sel_elem, b"activeCell=\"", 0).and_then(|p| {
                    let vs = p + 12;
                    extract_quoted_value(sel_elem, vs).and_then(|(s, e)| {
                        std::str::from_utf8(&sel_elem[s..e])
                            .ok()
                            .map(|v| v.to_string())
                    })
                });

                let active_cell_id =
                    find_attr_simd(sel_elem, b"activeCellId=\"", 0).and_then(|p| {
                        let vs = p + 14;
                        extract_quoted_value(sel_elem, vs).and_then(|(s, e)| {
                            std::str::from_utf8(&sel_elem[s..e])
                                .ok()?
                                .parse::<u32>()
                                .ok()
                        })
                    });

                let sqref = find_attr_simd(sel_elem, b"sqref=\"", 0).and_then(|p| {
                    let vs = p + 7;
                    extract_quoted_value(sel_elem, vs).and_then(|(s, e)| {
                        std::str::from_utf8(&sel_elem[s..e])
                            .ok()
                            .map(|v| v.to_string())
                    })
                });

                sv.selections.push(Selection {
                    pane,
                    active_cell,
                    active_cell_id,
                    sqref,
                });

                pos = sel_end;
            }
        }

        views.push(sv);

        // Advance past the closing </sheetView> tag (or past "/>") for self-closing tags)
        search_offset = if is_self_closing {
            view_end + 1
        } else {
            sheetview_block_end + b"</sheetView>".len()
        };
    }

    views
}

/// Parse sheet view options from worksheet XML (convenience wrapper).
///
/// Returns the first `<sheetView>` element, or `None` if not found.
/// Prefer `parse_sheet_views` for round-trip fidelity.
pub fn parse_sheet_view(xml: &[u8]) -> Option<ooxml_types::worksheet::SheetView> {
    parse_sheet_views(xml).into_iter().next()
}

/// Parse the `<legacyDrawing r:id="..."/>` element from worksheet XML.
///
/// Returns the relationship ID if found. This element links the sheet to its
/// VML drawing part (used for comment shapes, form controls, etc.).
pub fn parse_legacy_drawing_r_id(xml: &[u8]) -> Option<String> {
    let tag_start = find_tag_simd(xml, b"legacyDrawing", 0)?;
    // Make sure this is `<legacyDrawing` not `<legacyDrawingHF`
    let after = tag_start + b"<legacyDrawing".len();
    if after < xml.len() && xml[after] != b' ' && xml[after] != b'/' && xml[after] != b'>' {
        return None;
    }
    let tag_end = find_gt_simd(xml, tag_start)?;
    let element = &xml[tag_start..tag_end + 1];

    // Look for r:id attribute
    let attr_pos = find_attr_simd(element, b"r:id=\"", 0)?;
    let value_start = attr_pos + b"r:id=\"".len();
    let (start, end) = extract_quoted_value(element, value_start)?;
    std::str::from_utf8(&element[start..end])
        .ok()
        .map(|s| s.to_string())
}

/// Parse the `<legacyDrawingHF r:id="..."/>` element from worksheet XML.
///
/// Returns the relationship ID if found. This element links the sheet to its
/// VML drawing part that contains header/footer images.
pub fn parse_legacy_drawing_hf_r_id(xml: &[u8]) -> Option<String> {
    let tag_start = find_tag_simd(xml, b"legacyDrawingHF", 0)?;
    let tag_end = find_gt_simd(xml, tag_start)?;
    let element = &xml[tag_start..tag_end + 1];

    let attr_pos = find_attr_simd(element, b"r:id=\"", 0)?;
    let value_start = attr_pos + b"r:id=\"".len();
    let (start, end) = extract_quoted_value(element, value_start)?;
    std::str::from_utf8(&element[start..end])
        .ok()
        .map(|s| s.to_string())
}

// =============================================================================
// AutoFilter (raw passthrough)
// =============================================================================

/// Extract the raw `<autoFilter ...>` element from worksheet XML for verbatim round-trip.
///
/// Returns the complete element as a string (including both self-closing and container forms).
/// Scans `post_sd` (the region after `</sheetData>`).
pub fn extract_auto_filter_xml(post_sd: &[u8]) -> Option<String> {
    let tag_start = find_tag_simd(post_sd, b"autoFilter", 0)?;
    // Find the end of this element — could be self-closing or have children.
    let after_tag = tag_start + b"<autoFilter".len();
    // Scan for self-closing "/>" vs ">"
    let mut i = after_tag;
    while i < post_sd.len() {
        if post_sd[i] == b'/' && i + 1 < post_sd.len() && post_sd[i + 1] == b'>' {
            // Self-closing: <autoFilter ... />
            let end = i + 2;
            return std::str::from_utf8(&post_sd[tag_start..end])
                .ok()
                .map(|s| s.to_string());
        }
        if post_sd[i] == b'>' {
            // Opening tag — find closing </autoFilter>
            let closing = scanner::find_closing_tag(post_sd, b"autoFilter", tag_start)?;
            // find_closing_tag returns the position of '<' in '</autoFilter>'.
            // We need to include the full closing tag, so find the '>' after it.
            let closing_end = memchr::memchr(b'>', &post_sd[closing..])
                .map(|offset| closing + offset + 1)
                .unwrap_or(post_sd.len());
            return std::str::from_utf8(&post_sd[tag_start..closing_end])
                .ok()
                .map(|s| s.to_string());
        }
        i += 1;
    }
    None
}

/// Extract the raw `<customProperties>...</customProperties>` element from post-sheetData XML.
///
/// These are worksheet-level custom property references that link to binary parts
/// via r:id attributes. Returns the complete element as a string for opaque passthrough.
pub fn extract_custom_properties_xml(post_sd: &[u8]) -> Option<String> {
    let tag_start = find_tag_simd(post_sd, b"customProperties", 0)?;
    let closing = scanner::find_closing_tag(post_sd, b"customProperties", tag_start)?;
    let closing_end = memchr::memchr(b'>', &post_sd[closing..])
        .map(|offset| closing + offset + 1)
        .unwrap_or(post_sd.len());
    std::str::from_utf8(&post_sd[tag_start..closing_end])
        .ok()
        .map(|s| s.to_string())
}

/// Parse the standalone worksheet-level `<sortState>` element into a typed
/// [`domain_types::SortState`].
///
/// Only extracts **standalone** `<sortState>` elements — those that appear
/// directly under `<worksheet>`, NOT nested inside `<autoFilter>`.
/// When `<sortState>` is a child of `<autoFilter>`, the autoFilter parser
/// already captures it, so extracting it separately would cause duplication.
///
/// Typed OOXML preservation replaced the prior raw-XML passthrough
/// (`extract_sort_state_xml`) with this typed parser so the worksheet-level
/// sort state survives the parse → domain → write path losslessly. Previously
/// the writer would silently drop sort state whenever the blob was absent
/// (L2 / Yrs path).
pub fn parse_standalone_sort_state(post_sd: &[u8]) -> Option<domain_types::SortState> {
    // Determine the byte range occupied by <autoFilter>...</autoFilter> (if any)
    // so we can skip any <sortState> found inside it.
    let auto_filter_end = find_auto_filter_end(post_sd);

    // Search for <sortState> starting after the autoFilter region (or from the beginning if none).
    let search_start = auto_filter_end.unwrap_or(0);
    let tag_start = find_tag_simd(post_sd, b"sortState", search_start)?;
    let tag_end = find_gt_simd(post_sd, tag_start)?;

    parse_sort_state_element(&post_sd[tag_start..], tag_end - tag_start)
}

/// Public entry point for parsing a `<sortState ...>` element slice.
///
/// Used by the auto-filter parser, which sees `<sortState>` nested inside
/// `<autoFilter>` and needs the same typed representation.
pub(crate) fn parse_sort_state_slice(
    slice: &[u8],
    tag_end_offset: usize,
) -> Option<domain_types::SortState> {
    parse_sort_state_element(slice, tag_end_offset)
}

/// Parse a `<sortState ...>` element into a typed
/// [`domain_types::SortState`]. The input slice starts at the `<` of the
/// opening tag; `tag_end_offset` is the index of the `>` that closes the
/// opening tag (relative to `slice`).
fn parse_sort_state_element(
    slice: &[u8],
    tag_end_offset: usize,
) -> Option<domain_types::SortState> {
    // Attribute bytes span from the opening '<' through just before the '>'.
    let attr_bytes = &slice[..=tag_end_offset];

    let range_ref = parse_string_attr(attr_bytes, b"ref=\"").unwrap_or_default();
    let column_sort = parse_bool_attr_opt(attr_bytes, b"columnSort=\"").unwrap_or(false);
    let case_sensitive = parse_bool_attr_opt(attr_bytes, b"caseSensitive=\"").unwrap_or(false);
    let sort_method = parse_string_attr(attr_bytes, b"sortMethod=\"")
        .and_then(|s| domain_types::SortMethod::from_ooxml_token(&s))
        .unwrap_or(domain_types::SortMethod::None);

    let mut state = domain_types::SortState {
        range_ref,
        namespace_attrs: parse_namespace_attrs(attr_bytes),
        column_sort,
        case_sensitive,
        sort_method,
        conditions: Vec::new(),
    };

    // Self-closing <sortState .../> — no children.
    let is_self_closing = tag_end_offset > 0 && slice[tag_end_offset - 1] == b'/';
    if is_self_closing {
        return Some(state);
    }

    // Children: <sortCondition .../> — collect until </sortState>.
    let closing = scanner::find_closing_tag(slice, b"sortState", 0)?;
    let inner = &slice[tag_end_offset + 1..closing];

    let mut pos = 0;
    while let Some(sc_start) = find_tag_simd(inner, b"sortCondition", pos) {
        let sc_end = find_gt_simd(inner, sc_start)
            .map(|p| p + 1)
            .unwrap_or(inner.len());
        if let Some(cond) = parse_sort_condition(&inner[sc_start..sc_end]) {
            state.conditions.push(cond);
        }
        pos = sc_end;
    }

    Some(state)
}

/// Parse a self-closing `<sortCondition .../>` element.
fn parse_sort_condition(slice: &[u8]) -> Option<domain_types::SortCondition> {
    let range_ref = parse_string_attr(slice, b"ref=\"").unwrap_or_default();
    let descending = parse_bool_attr_opt(slice, b"descending=\"").unwrap_or(false);
    let sort_by = parse_string_attr(slice, b"sortBy=\"")
        .and_then(|s| domain_types::SortConditionBy::from_ooxml_token(&s))
        .unwrap_or(domain_types::SortConditionBy::Value);
    let custom_list = parse_string_attr(slice, b"customList=\"");
    let dxf_id = parse_u32_attr(slice, b"dxfId=\"");
    let icon_set = parse_string_attr(slice, b"iconSet=\"").and_then(|s| {
        ooxml_types::cond_format::IconSetType::from_ooxml_token(&s).or_else(|| {
            tracing::warn!(
                token = %s,
                "unknown IconSetType OOXML token on worksheet sortCondition; dropping attribute"
            );
            None
        })
    });
    let icon_id = parse_u32_attr(slice, b"iconId=\"");

    Some(domain_types::SortCondition {
        range_ref,
        descending,
        sort_by,
        custom_list,
        dxf_id,
        icon_set,
        icon_id,
    })
}

fn parse_namespace_attrs(tag: &[u8]) -> Vec<(String, String)> {
    let mut attrs = Vec::new();
    let mut pos = 0;

    while let Some(rel_start) = memchr::memmem::find(&tag[pos..], b"xmlns") {
        let start = pos + rel_start;
        let after_name = if tag.get(start + 5) == Some(&b':') {
            let prefix_start = start + 6;
            let Some(eq_rel) = memchr::memchr(b'=', &tag[prefix_start..]) else {
                break;
            };
            let eq = prefix_start + eq_rel;
            let prefix = String::from_utf8_lossy(&tag[prefix_start..eq]).into_owned();
            if let Some((value_start, value_end)) = extract_quoted_value(tag, eq + 2) {
                attrs.push((
                    prefix,
                    String::from_utf8_lossy(&tag[value_start..value_end]).into_owned(),
                ));
            }
            eq + 1
        } else if tag.get(start + 5) == Some(&b'=') {
            if let Some((value_start, value_end)) = extract_quoted_value(tag, start + 7) {
                attrs.push((
                    String::new(),
                    String::from_utf8_lossy(&tag[value_start..value_end]).into_owned(),
                ));
            }
            start + 6
        } else {
            start + 5
        };
        pos = after_name;
    }

    attrs
}

/// Find the byte offset just past the end of the `<autoFilter>` element in `post_sd`.
/// Returns `None` if no `<autoFilter>` is found.
fn find_auto_filter_end(post_sd: &[u8]) -> Option<usize> {
    let tag_start = find_tag_simd(post_sd, b"autoFilter", 0)?;
    let after_tag = tag_start + b"<autoFilter".len();
    let mut i = after_tag;
    while i < post_sd.len() {
        if post_sd[i] == b'/' && i + 1 < post_sd.len() && post_sd[i + 1] == b'>' {
            return Some(i + 2);
        }
        if post_sd[i] == b'>' {
            // Has children — find closing </autoFilter>
            let closing = scanner::find_closing_tag(post_sd, b"autoFilter", tag_start)?;
            let closing_end = memchr::memchr(b'>', &post_sd[closing..])
                .map(|offset| closing + offset + 1)
                .unwrap_or(post_sd.len());
            return Some(closing_end);
        }
        i += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_merge_cells() {
        let xml =
            br#"<worksheet><mergeCells><mergeCell ref="A1:B2"/><mergeCell ref="C3:D4"/></mergeCells></worksheet>"#;
        let merges = parse_merge_cells(xml);
        assert_eq!(merges.len(), 2);
        assert_eq!(merges[0].ref_range, "A1:B2");
        assert_eq!(merges[1].ref_range, "C3:D4");
    }

    #[test]
    fn test_parse_merge_cells_empty() {
        let xml = br#"<worksheet></worksheet>"#;
        let merges = parse_merge_cells(xml);
        assert!(merges.is_empty());
    }

    #[test]
    fn test_parse_frozen_pane() {
        let xml = br#"<worksheet><sheetViews><sheetView><pane xSplit="1" ySplit="2" topLeftCell="B3" state="frozen"/></sheetView></sheetViews></worksheet>"#;
        let pane = parse_frozen_pane(xml);
        assert!(pane.is_some());
        let p = pane.unwrap();
        assert_eq!(p.x_split, 1.0);
        assert_eq!(p.y_split, 2.0);
        assert_eq!(p.top_left_cell.as_deref(), Some("B3"));
        assert_eq!(p.effective_state(), PaneState::Frozen);
    }

    #[test]
    fn test_parse_frozen_pane_keeps_split_counts_independent_of_scroll() {
        let xml = br#"<worksheet><sheetViews><sheetView><pane xSplit="8" ySplit="7" topLeftCell="AI34" activePane="bottomRight" state="frozen"/></sheetView></sheetViews></worksheet>"#;
        let pane = parse_frozen_pane(xml).unwrap();

        assert_eq!(pane.x_split, 8.0);
        assert_eq!(pane.y_split, 7.0);
        assert_eq!(pane.top_left_cell.as_deref(), Some("AI34"));
    }

    #[test]
    fn test_parse_split_pane() {
        let xml = br#"<worksheet><sheetViews><sheetView><pane xSplit="1" ySplit="2" state="split"/></sheetView></sheetViews></worksheet>"#;
        let pane = parse_frozen_pane(xml);
        assert!(pane.is_some()); // now returns all pane types
        let p = pane.unwrap();
        assert_eq!(p.effective_state(), PaneState::Split);
        assert_eq!(p.x_split, 1.0);
        assert_eq!(p.y_split, 2.0);
    }

    #[test]
    fn test_parse_frozen_pane_frozen_split() {
        let xml = br#"<worksheet><sheetViews><sheetView><pane xSplit="2" ySplit="3" topLeftCell="C4" state="frozenSplit"/></sheetView></sheetViews></worksheet>"#;
        let pane = parse_frozen_pane(xml);
        assert!(pane.is_some());
        let p = pane.unwrap();
        assert_eq!(p.x_split, 2.0);
        assert_eq!(p.y_split, 3.0);
        assert_eq!(p.top_left_cell.as_deref(), Some("C4"));
        assert_eq!(p.effective_state(), PaneState::FrozenSplit);
    }

    #[test]
    fn test_parse_pane_active_pane() {
        let xml = br#"<worksheet><sheetViews><sheetView><pane xSplit="1" ySplit="2" topLeftCell="B3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews></worksheet>"#;
        let pane = parse_frozen_pane(xml).unwrap();
        assert_eq!(pane.effective_active_pane(), Pane::BottomLeft);
    }

    #[test]
    fn test_parse_dimensions_col_widths() {
        // A single <col min="1" max="3" ...> should be preserved as one ColWidth range entry.
        let xml = br#"<worksheet><cols><col min="1" max="3" width="15.5"/></cols></worksheet>"#;
        let (col_widths, row_heights) = parse_dimensions(xml);
        assert_eq!(col_widths.len(), 1);
        assert_eq!(col_widths[0].min, 1);
        assert_eq!(col_widths[0].max, 3);
        assert_eq!(col_widths[0].col, 0); // 0-based, set to min-1
        assert_eq!(col_widths[0].width, Some(15.5));
        assert!(row_heights.is_empty());
    }

    #[test]
    fn test_parse_dimensions_row_heights() {
        let xml = br#"<worksheet><sheetData><row r="1" ht="20.0"/><row r="2"/><row r="3" ht="25.5"/></sheetData></worksheet>"#;
        let (col_widths, row_heights) = parse_dimensions(xml);
        assert!(col_widths.is_empty());
        assert_eq!(row_heights.len(), 2);
        assert_eq!(row_heights[0].row, 0); // 0-based
        assert_eq!(row_heights[0].height, 20.0);
        assert_eq!(row_heights[1].row, 2);
        assert_eq!(row_heights[1].height, 25.5);
    }

    #[test]
    fn test_parse_col_widths() {
        // A single <col min="1" max="3" ...> should be preserved as one ColWidth range entry.
        let xml = br#"<worksheet><cols><col min="1" max="3" width="15.5"/></cols></worksheet>"#;
        let col_widths = parse_col_widths(xml);
        assert_eq!(col_widths.len(), 1);
        assert_eq!(col_widths[0].min, 1);
        assert_eq!(col_widths[0].max, 3);
        assert_eq!(col_widths[0].col, 0); // 0-based, set to min-1
        assert_eq!(col_widths[0].width, Some(15.5));
    }

    #[test]
    fn test_parse_sheet_view_gridlines_hidden() {
        let xml = br#"<worksheet><sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews></worksheet>"#;
        let view = parse_sheet_view(xml).unwrap();
        assert_eq!(view.show_grid_lines, false);
        assert_eq!(view.show_row_col_headers, true); // default
    }

    #[test]
    fn test_parse_sheet_view_headers_hidden() {
        let xml = br#"<worksheet><sheetViews><sheetView showRowColHeaders="0" workbookViewId="0"/></sheetViews></worksheet>"#;
        let view = parse_sheet_view(xml).unwrap();
        assert_eq!(view.show_grid_lines, true); // default
        assert_eq!(view.show_row_col_headers, false);
    }

    #[test]
    fn test_parse_sheet_view_both_hidden() {
        let xml = br#"<worksheet><sheetViews><sheetView showGridLines="0" showRowColHeaders="0" workbookViewId="0"/></sheetViews></worksheet>"#;
        let view = parse_sheet_view(xml).unwrap();
        assert_eq!(view.show_grid_lines, false);
        assert_eq!(view.show_row_col_headers, false);
    }

    #[test]
    fn test_parse_sheet_view_all_defaults() {
        // When everything is default, we still return Some now (the SheetView was found)
        let xml = br#"<worksheet><sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews></worksheet>"#;
        let view = parse_sheet_view(xml).unwrap();
        assert_eq!(view.show_grid_lines, true);
        assert_eq!(view.tab_selected, true);
    }

    #[test]
    fn test_parse_sheet_view_explicit_true() {
        let xml = br#"<worksheet><sheetViews><sheetView showGridLines="1" showRowColHeaders="1" workbookViewId="0"/></sheetViews></worksheet>"#;
        let view = parse_sheet_view(xml).unwrap();
        assert_eq!(view.show_grid_lines, true);
        assert_eq!(view.show_row_col_headers, true);
    }

    #[test]
    fn test_parse_sheet_view_not_found() {
        let xml = b"<worksheet><sheetData/></worksheet>";
        assert!(parse_sheet_view(xml).is_none());
    }

    #[test]
    fn test_parse_sheet_view_top_left_cell() {
        let xml = br#"<worksheet><sheetViews><sheetView topLeftCell="D50" workbookViewId="0"/></sheetViews></worksheet>"#;
        let view = parse_sheet_view(xml).unwrap();
        assert_eq!(view.top_left_cell.as_deref(), Some("D50"));
    }

    #[test]
    fn test_parse_sheet_view_zoom_scale() {
        let xml = br#"<worksheet><sheetViews><sheetView zoomScale="150" zoomScaleNormal="100" workbookViewId="0"/></sheetViews></worksheet>"#;
        let view = parse_sheet_view(xml).unwrap();
        assert_eq!(view.zoom_scale, 150);
        assert_eq!(view.zoom_scale_normal, 100);
    }

    #[test]
    fn test_parse_sheet_view_right_to_left() {
        let xml = br#"<worksheet><sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews></worksheet>"#;
        let view = parse_sheet_view(xml).unwrap();
        assert_eq!(view.right_to_left, true);
    }

    #[test]
    fn test_parse_sheet_view_page_layout() {
        let xml = br#"<worksheet><sheetViews><sheetView view="pageLayout" workbookViewId="0"/></sheetViews></worksheet>"#;
        let view = parse_sheet_view(xml).unwrap();
        assert_eq!(view.view, ooxml_types::worksheet::SheetViewType::PageLayout);
    }

    #[test]
    fn test_parse_legacy_drawing_r_id() {
        let xml = br#"<worksheet><sheetData/><legacyDrawing r:id="rId3"/></worksheet>"#;
        assert_eq!(
            super::parse_legacy_drawing_r_id(xml).as_deref(),
            Some("rId3")
        );

        let xml2 = br#"<worksheet><sheetData/></worksheet>"#;
        assert_eq!(super::parse_legacy_drawing_r_id(xml2), None);
    }

    #[test]
    fn test_extract_auto_filter_xml_self_closing() {
        let xml = br#"<autoFilter ref="A3:S4649" xr:uid="{ABC}"/><mergeCells>"#;
        let result = extract_auto_filter_xml(xml);
        assert_eq!(
            result.as_deref(),
            Some(r#"<autoFilter ref="A3:S4649" xr:uid="{ABC}"/>"#)
        );
    }

    #[test]
    fn test_extract_auto_filter_xml_with_children() {
        let xml = br#"<autoFilter ref="A1:D10"><filterColumn colId="0"><filters><filter val="X"/></filters></filterColumn></autoFilter><mergeCells>"#;
        let result = extract_auto_filter_xml(xml);
        assert_eq!(
            result.as_deref(),
            Some(
                r#"<autoFilter ref="A1:D10"><filterColumn colId="0"><filters><filter val="X"/></filters></filterColumn></autoFilter>"#
            )
        );
    }

    #[test]
    fn test_extract_auto_filter_xml_none() {
        let xml = br#"<mergeCells><mergeCell ref="A1:B2"/></mergeCells>"#;
        let result = extract_auto_filter_xml(xml);
        assert_eq!(result, None);
    }

    // ─ Typed OOXML preservation: typed sort-state parsing ─

    #[test]
    fn test_parse_standalone_sort_state_self_closing() {
        let xml = br#"<sortState ref="A1:D20"/>"#;
        let result = super::parse_standalone_sort_state(xml).expect("parse");
        assert_eq!(result.range_ref, "A1:D20");
        assert_eq!(result.column_sort, false);
        assert_eq!(result.case_sensitive, false);
        assert_eq!(result.sort_method, domain_types::SortMethod::None);
        assert!(result.conditions.is_empty());
    }

    #[test]
    fn test_parse_standalone_sort_state_with_conditions() {
        let xml = br#"<sortState ref="A1:D20" caseSensitive="1" sortMethod="pinYin"><sortCondition descending="1" ref="A1:A20" sortBy="value" customList="High,Med,Low" dxfId="3"/></sortState>"#;
        let result = super::parse_standalone_sort_state(xml).expect("parse");
        assert_eq!(result.range_ref, "A1:D20");
        assert!(result.case_sensitive);
        assert_eq!(result.sort_method, domain_types::SortMethod::PinYin);
        assert_eq!(result.conditions.len(), 1);
        let cond = &result.conditions[0];
        assert_eq!(cond.range_ref, "A1:A20");
        assert!(cond.descending);
        assert_eq!(cond.sort_by, domain_types::SortConditionBy::Value);
        assert_eq!(cond.custom_list.as_deref(), Some("High,Med,Low"));
        assert_eq!(cond.dxf_id, Some(3));
    }

    #[test]
    fn test_parse_standalone_sort_state_icon_condition() {
        let xml = br#"<sortState ref="B2:B10"><sortCondition ref="B2:B10" sortBy="icon" iconSet="3TrafficLights1" iconId="1"/></sortState>"#;
        let result = super::parse_standalone_sort_state(xml).expect("parse");
        let cond = &result.conditions[0];
        assert_eq!(cond.sort_by, domain_types::SortConditionBy::Icon);
        assert_eq!(
            cond.icon_set,
            Some(ooxml_types::cond_format::IconSetType::ThreeTrafficLights1)
        );
        assert_eq!(cond.icon_id, Some(1));
    }

    #[test]
    fn test_parse_standalone_sort_state_skips_autofilter_nested() {
        // <autoFilter> contains a <sortState>; standalone lookup must NOT
        // return the nested one — it's already captured by the autoFilter blob.
        let xml = br#"<autoFilter ref="A1:D20"><sortState ref="A1:A20"><sortCondition ref="A1:A20"/></sortState></autoFilter>"#;
        let result = super::parse_standalone_sort_state(xml);
        assert!(
            result.is_none(),
            "nested sortState inside autoFilter must not be picked up by the standalone parser"
        );
    }

    #[test]
    fn test_parse_standalone_sort_state_absent() {
        let xml = br#"<mergeCells><mergeCell ref="A1:B2"/></mergeCells>"#;
        assert!(super::parse_standalone_sort_state(xml).is_none());
    }

    #[test]
    fn test_parse_standalone_sort_state_after_autofilter() {
        // autoFilter has no nested sortState; a sibling <sortState> follows it.
        let xml = br#"<autoFilter ref="A1:D20"/><sortState ref="A1:D20" columnSort="1"><sortCondition ref="A1:A20" descending="1"/></sortState>"#;
        let result = super::parse_standalone_sort_state(xml).expect("parse");
        assert!(result.column_sort);
        assert_eq!(result.conditions.len(), 1);
        assert!(result.conditions[0].descending);
    }
}
