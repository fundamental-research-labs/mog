//! Header and footer settings for print output.
//!
//! This module contains the HeaderFooter struct and related functionality
//! for specifying headers and footers in worksheet print settings.

// ============================================================================
// Header/Footer Settings
// ============================================================================

/// Header and footer settings (CT_HeaderFooter).
#[derive(Debug, Clone)]
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

impl Default for HeaderFooter {
    fn default() -> Self {
        Self {
            odd_header: None,
            odd_footer: None,
            even_header: None,
            even_footer: None,
            first_header: None,
            first_footer: None,
            different_odd_even: false,
            different_first: false,
            scale_with_doc: None,
            align_with_margins: None,
        }
    }
}

impl HeaderFooter {
    /// Create new empty header/footer settings.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set simple header (centered text).
    pub fn header(&mut self, text: &str) -> &mut Self {
        self.odd_header = Some(format!("&C{}", text));
        self
    }

    /// Set simple footer (centered text).
    pub fn footer(&mut self, text: &str) -> &mut Self {
        self.odd_footer = Some(format!("&C{}", text));
        self
    }

    /// Set header with left/center/right sections.
    pub fn header_lcr(&mut self, left: &str, center: &str, right: &str) -> &mut Self {
        let mut header = String::new();
        if !left.is_empty() {
            header.push_str("&L");
            header.push_str(left);
        }
        if !center.is_empty() {
            header.push_str("&C");
            header.push_str(center);
        }
        if !right.is_empty() {
            header.push_str("&R");
            header.push_str(right);
        }
        self.odd_header = if header.is_empty() {
            None
        } else {
            Some(header)
        };
        self
    }

    /// Set footer with left/center/right sections.
    pub fn footer_lcr(&mut self, left: &str, center: &str, right: &str) -> &mut Self {
        let mut footer = String::new();
        if !left.is_empty() {
            footer.push_str("&L");
            footer.push_str(left);
        }
        if !center.is_empty() {
            footer.push_str("&C");
            footer.push_str(center);
        }
        if !right.is_empty() {
            footer.push_str("&R");
            footer.push_str(right);
        }
        self.odd_footer = if footer.is_empty() {
            None
        } else {
            Some(footer)
        };
        self
    }

    /// Check if any header/footer content is set.
    pub fn has_content(&self) -> bool {
        self.odd_header.is_some()
            || self.odd_footer.is_some()
            || self.even_header.is_some()
            || self.even_footer.is_some()
            || self.first_header.is_some()
            || self.first_footer.is_some()
    }
}
