/// Represents a parsed section of a header or footer.
///
/// A header/footer string is divided into left, center, and right sections
/// by the `&L`, `&C`, and `&R` delimiters. Other format codes (like `&P`
/// for page number) are preserved verbatim in the section text.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct HeaderFooterSection {
    /// Left-aligned content
    pub left: String,
    /// Center-aligned content
    pub center: String,
    /// Right-aligned content
    pub right: String,
}

impl HeaderFooterSection {
    /// Parse a header/footer string into sections.
    ///
    /// Format codes `&L`, `&C`, `&R` delimit sections (case-insensitive).
    /// Other format codes (`&P`, `&N`, `&D`, etc.) are preserved in the content.
    ///
    /// Text before any section marker defaults to the center section.
    ///
    /// # Example
    ///
    /// ```
    /// use ooxml_types::print::HeaderFooterSection;
    ///
    /// let section = HeaderFooterSection::parse("&LPage &P of &N&C&D&RFile: &F");
    /// assert_eq!(section.left, "Page &P of &N");
    /// assert_eq!(section.center, "&D");
    /// assert_eq!(section.right, "File: &F");
    /// ```
    pub fn parse(content: &str) -> Self {
        let mut section = HeaderFooterSection::default();
        let mut current_section = &mut section.center; // Default to center
        let mut chars = content.chars().peekable();
        let mut current_text = String::new();

        while let Some(ch) = chars.next() {
            if ch == '&' {
                if let Some(&next_ch) = chars.peek() {
                    match next_ch {
                        '&' => {
                            current_text.push('&');
                            current_text.push('&');
                            chars.next();
                        }
                        'L' | 'l' => {
                            if !current_text.is_empty() {
                                current_section.push_str(&current_text);
                                current_text.clear();
                            }
                            current_section = &mut section.left;
                            chars.next();
                        }
                        'C' | 'c' => {
                            if !current_text.is_empty() {
                                current_section.push_str(&current_text);
                                current_text.clear();
                            }
                            current_section = &mut section.center;
                            chars.next();
                        }
                        'R' | 'r' => {
                            if !current_text.is_empty() {
                                current_section.push_str(&current_text);
                                current_text.clear();
                            }
                            current_section = &mut section.right;
                            chars.next();
                        }
                        _ => {
                            // Other format code, preserve it
                            current_text.push('&');
                        }
                    }
                } else {
                    current_text.push('&');
                }
            } else {
                current_text.push(ch);
            }
        }

        // Flush remaining text
        if !current_text.is_empty() {
            current_section.push_str(&current_text);
        }

        section
    }

    /// Check if all sections are empty.
    pub fn is_empty(&self) -> bool {
        self.left.is_empty() && self.center.is_empty() && self.right.is_empty()
    }
}

// ============================================================================
// Header/Footer
// ============================================================================

/// Header and footer settings (ECMA-376 CT_HeaderFooter).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct HeaderFooter {
    /// Odd page header (also used for all pages if even/first not specified)
    pub odd_header: Option<String>,
    /// Odd page footer
    pub odd_footer: Option<String>,
    /// Even page header (for different even/odd headers)
    pub even_header: Option<String>,
    /// Even page footer
    pub even_footer: Option<String>,
    /// First page header (for different first page)
    pub first_header: Option<String>,
    /// First page footer
    pub first_footer: Option<String>,
    /// Use different headers/footers for odd and even pages
    pub different_odd_even: bool,
    /// Use different header/footer for the first page
    pub different_first: bool,
    /// Scale headers/footers with document scaling (None = not specified, uses ECMA-376 default of true)
    pub scale_with_doc: Option<bool>,
    /// Align headers/footers with page margins (None = not specified, uses ECMA-376 default of true)
    pub align_with_margins: Option<bool>,
}

impl HeaderFooter {
    /// Get the parsed odd header sections.
    pub fn odd_header_sections(&self) -> HeaderFooterSection {
        self.odd_header
            .as_ref()
            .map(|s| HeaderFooterSection::parse(s))
            .unwrap_or_default()
    }

    /// Get the parsed odd footer sections.
    pub fn odd_footer_sections(&self) -> HeaderFooterSection {
        self.odd_footer
            .as_ref()
            .map(|s| HeaderFooterSection::parse(s))
            .unwrap_or_default()
    }
}
