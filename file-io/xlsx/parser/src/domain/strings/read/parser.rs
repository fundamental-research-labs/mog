use super::StringRef;
use super::phonetic::extract_phonetic_xml;
use super::scanner::{
    find_byte, find_bytes, find_t_content, needs_xml_text_decode, parse_unique_count,
};
use crate::infra::error::{ErrorCode, ErrorLocation, ParseContext, ParseErrorDetail, ParseMode};
use crate::zip::constants::MAX_SHARED_STRINGS;
use memchr::memmem;

/// Parse shared strings from XLSX sharedStrings.xml content
///
/// # Arguments
/// * `xml` - The raw XML bytes of sharedStrings.xml
///
/// # Returns
/// A vector of StringRef pointing into the original XML buffer
pub fn parse_shared_strings_fast(xml: &[u8]) -> Vec<StringRef> {
    // Pre-allocate based on uniqueCount if available
    let capacity = parse_unique_count(xml).unwrap_or(1000);
    let mut strings = Vec::with_capacity(capacity);

    // Find start of string items
    let sst_end = match find_bytes(xml, b"<sst", 0) {
        Some(pos) => find_byte(xml, b'>', pos).unwrap_or(0),
        None => return strings,
    };

    let mut pos = sst_end;

    // Parse each <si> element
    while let Some(si_start) = find_bytes(xml, b"<si", pos) {
        // Find end of this <si> element
        let si_end = match find_bytes(xml, b"</si>", si_start) {
            Some(end) => end,
            None => break,
        };

        // Check if this is a simple string or rich text (bounded search within <si>)
        let has_rich_text = has_rich_text_run(&xml[si_start..si_end]);

        if has_rich_text {
            // Rich text: concatenate all <t> elements
            // For rich text, we need to mark that concatenation is needed
            // We store the entire <si> element range and mark needs_decode = true
            // to signal that special handling is required
            if find_t_content(xml, si_start, si_end).is_some() {
                // Store reference to entire <si> range - decoder will handle extraction
                strings.push(StringRef {
                    start: si_start,
                    len: si_end - si_start,
                    needs_decode: true, // Always needs processing for rich text
                });
            } else {
                // No <t> found, empty string
                strings.push(StringRef::new(0, 0, false));
            }
        } else {
            // Simple case: single <t> element
            if let Some((content_start, content_end)) = find_t_content(xml, si_start, si_end) {
                let content = &xml[content_start..content_end];
                strings.push(StringRef {
                    start: content_start,
                    len: content_end - content_start,
                    needs_decode: needs_xml_text_decode(content),
                });
            } else {
                // No <t> element found, might be empty <si></si> or <si/>
                strings.push(StringRef::new(0, 0, false));
            }
        }

        pos = si_end + 5; // Move past </si>
    }

    strings
}

/// Parse shared strings with error recovery support
///
/// This function extends `parse_shared_strings_fast` with error recovery based on
/// the provided `ParseContext`. It handles:
///
/// - Missing uniqueCount attribute: Counts entries manually
/// - Truncated string table: Parses what's available and logs warning
/// - Malformed <si> elements: Skips them and logs error
///
/// # Arguments
/// * `xml` - The raw XML bytes of sharedStrings.xml
/// * `context` - Parse context for error handling
///
/// # Returns
/// A vector of StringRef pointing into the original XML buffer
pub fn parse_shared_strings_with_context(
    xml: &[u8],
    context: &mut ParseContext,
) -> (Vec<StringRef>, Vec<Option<Vec<u8>>>, Option<Vec<u8>>) {
    // Handle empty XML
    if xml.is_empty() {
        context.report_warning(ErrorCode::MissingPart, "Empty shared strings XML");
        return (Vec::new(), Vec::new(), None);
    }
    let root_ext_lst_xml = extract_safe_root_ext_lst_xml(xml, context);

    // Try to get uniqueCount for pre-allocation
    let unique_count = parse_unique_count(xml);
    if let Some(count) = unique_count
        && count > MAX_SHARED_STRINGS
    {
        context.report_error_detail(
            ParseErrorDetail::fatal(
                ErrorCode::DataCorruption,
                format!(
                    "sharedStrings.xml declares uniqueCount {} above parser limit {}",
                    count, MAX_SHARED_STRINGS
                ),
            )
            .with_location(ErrorLocation::new("xl/sharedStrings.xml")),
        );
        return (Vec::new(), Vec::new(), root_ext_lst_xml);
    }
    let capacity = unique_count.unwrap_or_else(|| {
        if context.mode != ParseMode::Strict {
            context.report_warning(
                ErrorCode::MissingAttribute,
                "Missing uniqueCount attribute in <sst>, counting entries manually",
            );
        }
        // Estimate based on XML size (rough heuristic: ~50 bytes per entry)
        (xml.len() / 50).max(100)
    });

    let mut strings = Vec::with_capacity(capacity.min(MAX_SHARED_STRINGS));
    let mut phonetic_xml: Vec<Option<Vec<u8>>> =
        Vec::with_capacity(capacity.min(MAX_SHARED_STRINGS));

    // Quick check: if no phonetic data in the entire XML, skip per-entry extraction
    let has_any_phonetic =
        memmem::find(xml, b"<phoneticPr").is_some() || memmem::find(xml, b"<rPh").is_some();

    // Find start of string items - handle missing <sst> element
    let sst_end = match find_bytes(xml, b"<sst", 0) {
        Some(pos) => match find_byte(xml, b'>', pos) {
            Some(end) => end,
            None => {
                // Truncated <sst> element
                if context.mode == ParseMode::Strict {
                    context.report_error(
                        ErrorCode::MalformedXml,
                        "Truncated <sst> element - missing closing '>'",
                    );
                    return (strings, phonetic_xml, root_ext_lst_xml);
                }
                context.report_warning(
                    ErrorCode::MalformedXml,
                    "Truncated <sst> element - missing closing '>', attempting to parse anyway",
                );
                pos + 4 // Skip past "<sst"
            }
        },
        None => {
            // No <sst> element found
            context.report_error(
                ErrorCode::MalformedXml,
                "Missing <sst> element in sharedStrings.xml",
            );
            return (strings, phonetic_xml, root_ext_lst_xml);
        }
    };

    let mut pos = sst_end;
    let mut entry_count = 0;

    // Parse each <si> element
    while let Some(si_start) = find_bytes(xml, b"<si", pos) {
        // Find end of this <si> element
        let si_end = match find_bytes(xml, b"</si>", si_start) {
            Some(end) => end,
            None => {
                // Truncated string table - parse what we have
                context.report_warning(
                    ErrorCode::TruncatedFile,
                    &format!(
                        "Truncated shared string table at entry {} - missing </si>",
                        entry_count
                    ),
                );
                break;
            }
        };

        entry_count += 1;
        if entry_count > MAX_SHARED_STRINGS {
            context.report_error_detail(
                ParseErrorDetail::fatal(
                    ErrorCode::DataCorruption,
                    format!(
                        "sharedStrings.xml contains more than {} <si> entries",
                        MAX_SHARED_STRINGS
                    ),
                )
                .with_location(ErrorLocation::new("xl/sharedStrings.xml")),
            );
            break;
        }

        // Check if this is a simple string or rich text (bounded search within <si>)
        let has_rich_text = has_rich_text_run(&xml[si_start..si_end]);

        if has_rich_text {
            // Rich text: concatenate all <t> elements
            if find_t_content(xml, si_start, si_end).is_some() {
                strings.push(StringRef {
                    start: si_start,
                    len: si_end - si_start,
                    needs_decode: true,
                });
            } else {
                // No <t> found in rich text - malformed
                if context.mode == ParseMode::Strict {
                    context.report_error(
                        ErrorCode::MalformedXml,
                        &format!(
                            "Malformed rich text entry {} - no <t> element found",
                            entry_count
                        ),
                    );
                } else {
                    context.report_warning(
                        ErrorCode::MalformedXml,
                        &format!(
                            "Malformed rich text entry {} - using empty string",
                            entry_count
                        ),
                    );
                }
                strings.push(StringRef::new(0, 0, false));
            }
        } else {
            // Simple case: single <t> element
            if let Some((content_start, content_end)) = find_t_content(xml, si_start, si_end) {
                let content = &xml[content_start..content_end];
                strings.push(StringRef {
                    start: content_start,
                    len: content_end - content_start,
                    needs_decode: needs_xml_text_decode(content),
                });
            } else {
                // No <t> element found - might be empty or malformed
                strings.push(StringRef::new(0, 0, false));
            }
        }

        // Extract phonetic XML inline (avoids a second scan of the entire SST)
        if has_any_phonetic {
            let si_bytes = &xml[si_start..si_end];
            phonetic_xml.push(extract_phonetic_xml(si_bytes));
        } else {
            phonetic_xml.push(None);
        }

        pos = si_end + 5; // Move past </si>

        // Check if we should stop (in strict mode with errors)
        if context.should_stop() {
            break;
        }
    }

    // Verify entry count matches uniqueCount if provided
    if let Some(expected) = unique_count {
        if strings.len() != expected && context.mode != ParseMode::Permissive {
            context.report_warning(
                ErrorCode::DataCorruption,
                &format!(
                    "Shared string count mismatch: expected {} but found {}",
                    expected,
                    strings.len()
                ),
            );
        }
    }

    (strings, phonetic_xml, root_ext_lst_xml)
}

fn extract_safe_root_ext_lst_xml(xml: &[u8], context: &mut ParseContext) -> Option<Vec<u8>> {
    let sst_start = find_bytes(xml, b"<sst", 0)?;
    let sst_open_end = find_byte(xml, b'>', sst_start)?;
    let sst_close = find_bytes(xml, b"</sst>", sst_open_end).unwrap_or(xml.len());
    let mut pos = sst_open_end + 1;

    while pos < sst_close {
        let Some(next_si) = find_bytes(xml, b"<si", pos).filter(|p| *p < sst_close) else {
            break;
        };
        let Some(next_ext) = find_bytes(xml, b"<extLst", pos).filter(|p| *p < sst_close) else {
            break;
        };
        if next_ext < next_si {
            return extract_ext_lst_at(xml, next_ext, sst_close, context);
        }
        let Some(si_end) = find_bytes(xml, b"</si>", next_si).filter(|p| *p < sst_close) else {
            break;
        };
        pos = si_end + 5;
    }

    if let Some(next_ext) = find_bytes(xml, b"<extLst", pos).filter(|p| *p < sst_close) {
        return extract_ext_lst_at(xml, next_ext, sst_close, context);
    }

    None
}

fn extract_ext_lst_at(
    xml: &[u8],
    ext_start: usize,
    sst_close: usize,
    context: &mut ParseContext,
) -> Option<Vec<u8>> {
    let open_end = find_byte(xml, b'>', ext_start)?;
    let ext_end = if open_end > ext_start && xml[open_end.saturating_sub(1)] == b'/' {
        open_end + 1
    } else {
        find_bytes(xml, b"</extLst>", open_end)
            .filter(|p| *p < sst_close)
            .map(|p| p + b"</extLst>".len())?
    };
    let bytes = xml[ext_start..ext_end].to_vec();
    if has_unsafe_ext_lst_reference(&bytes) {
        context.report_warning(
            ErrorCode::UnsupportedFeature,
            "Dropped shared string table extLst because it contains relationship or active references",
        );
        return None;
    }
    Some(bytes)
}

fn has_unsafe_ext_lst_reference(bytes: &[u8]) -> bool {
    let lower = bytes
        .iter()
        .map(|b| b.to_ascii_lowercase())
        .collect::<Vec<_>>();
    [
        b"r:id".as_slice(),
        b"relationship".as_slice(),
        b" target=".as_slice(),
        b" ref=".as_slice(),
        b" sqref=".as_slice(),
        b"formula".as_slice(),
    ]
    .iter()
    .any(|needle| memmem::find(&lower, needle).is_some())
}

fn has_rich_text_run(bytes: &[u8]) -> bool {
    let mut pos = 0;
    while let Some(rel) = memmem::find(&bytes[pos..], b"<r") {
        let p = pos + rel + 2;
        if p < bytes.len() && matches!(bytes[p], b'>' | b' ' | b'\t' | b'\n' | b'\r') {
            return true;
        }
        pos += rel + 2;
    }
    false
}
