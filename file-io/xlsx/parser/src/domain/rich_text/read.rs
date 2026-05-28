//! Rich Text parser for XLSX files.
//!
//! This module parses rich text runs used in cells, comments, and text boxes.
//! Rich text in XLSX allows different formatting (bold, italic, font, color, etc.)
//! to be applied to portions of a single cell's text content.
//!
//! # Rich Text XML Structure
//!
//! Rich text in XLSX is represented using `<r>` (run) elements within an `<si>` (string item)
//! or directly in a cell. Each run can have optional run properties (`<rPr>`) followed by
//! the text content (`<t>`).
//!
//! ## Example XML
//!
//! ```xml
//! <si>
//!   <r>
//!     <rPr>
//!       <b/>                    <!-- Bold -->
//!       <sz val="11"/>          <!-- Font size -->
//!       <color theme="1"/>      <!-- Theme color -->
//!       <rFont val="Calibri"/>  <!-- Font name -->
//!     </rPr>
//!     <t>Bold Text</t>
//!   </r>
//!   <r>
//!     <t> Normal Text</t>
//!   </r>
//! </si>
//! ```
//!
//! # Phonetic Runs
//!
//! For Asian languages (Japanese, Chinese, Korean), phonetic annotations can be
//! included using `<rPh>` (phonetic run) elements with `<t>` text content.
//! These provide pronunciation guides (furigana/ruby text) for characters.

use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};

use super::runs::parse_text_content;
pub use super::types::{
    Color, FontProperties, PhoneticProperties, PhoneticRun, RichText, RunProperties, TextRun,
    UnderlineStyle, VerticalAlign,
};

impl RichText {
    /// Parse rich text from `<si>...</si>` or `<is>...</is>` XML bytes.
    ///
    /// Handles both simple text (`<t>text</t>`) and rich text (`<r>...</r>`).
    pub fn parse(xml: &[u8]) -> Self {
        let mut rich_text = RichText::default();

        let has_runs = find_tag_simd(xml, b"r", 0)
            .map(|pos| {
                pos + 2 < xml.len()
                    && (xml[pos + 2] == b'>' || xml[pos + 2] == b' ' || xml[pos + 2] == b'/')
            })
            .unwrap_or(false);

        if has_runs {
            rich_text.parse_runs(xml);
        } else if let Some(text) = parse_text_content(xml, 0) {
            if !text.is_empty() {
                rich_text.runs.push(TextRun::text_only(text));
            }
        }

        rich_text.parse_phonetic_runs(xml);

        if let Some(pp_start) = find_tag_simd(xml, b"phoneticPr", 0) {
            let pp_end = find_gt_simd(xml, pp_start).unwrap_or(xml.len());
            rich_text.phonetic_properties =
                Some(PhoneticProperties::parse(&xml[pp_start..=pp_end]));
        }

        rich_text
    }

    fn parse_runs(&mut self, xml: &[u8]) {
        let mut pos = 0;

        while let Some(r_start) = find_tag_simd(xml, b"r", pos) {
            if r_start + 2 < xml.len() {
                let next_char = xml[r_start + 2];
                if next_char != b'>' && next_char != b' ' && next_char != b'/' {
                    pos = r_start + 2;
                    continue;
                }
            }

            let r_end = find_closing_tag(xml, b"r", r_start).unwrap_or(xml.len());

            if r_start < r_end {
                let run = TextRun::parse(&xml[r_start..r_end]);
                self.runs.push(run);
            }

            pos = r_end + 4;
        }
    }

    fn parse_phonetic_runs(&mut self, xml: &[u8]) {
        let mut pos = 0;

        while let Some(rph_start) = find_tag_simd(xml, b"rPh", pos) {
            let rph_end = find_closing_tag(xml, b"rPh", rph_start).unwrap_or(xml.len());

            if rph_start < rph_end {
                let phonetic = PhoneticRun::parse(&xml[rph_start..rph_end]);
                self.phonetic_runs.push(phonetic);
            }

            pos = rph_end + 5;
        }
    }
}
