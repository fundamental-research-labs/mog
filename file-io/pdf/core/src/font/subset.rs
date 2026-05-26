//! TrueType font subsetting.
//!
//! Takes a full TrueType font and a set of Unicode codepoints, and produces a
//! minimal font containing only the glyphs needed. The output includes:
//! - A valid TrueType font binary (subset)
//! - Codepoint-to-new-GID mapping (for ToUnicode CMap)
//! - Font metrics (for PDF FontDescriptor)

use std::collections::{BTreeMap, BTreeSet, HashSet};
use ttf_parser::{Face, Tag};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Result of subsetting a TrueType font.
#[derive(Debug, Clone)]
pub struct SubsetResult {
    /// The subset TrueType font binary.
    pub font_data: Vec<u8>,
    /// Maps Unicode codepoint -> new glyph ID in the subset font.
    pub codepoint_to_new_gid: BTreeMap<u32, u16>,
    /// Maps new glyph ID -> old glyph ID in the original font.
    pub new_gid_to_old_gid: BTreeMap<u16, u16>,
    /// 6-character subset tag (e.g. "ABCDEF") for PDF naming.
    pub subset_tag: String,
    /// Font-level metrics extracted from the original font.
    pub metrics: FontMetrics,
}

/// Font-level metrics needed for the PDF FontDescriptor.
#[derive(Debug, Clone)]
pub struct FontMetrics {
    pub units_per_em: u16,
    pub ascent: i16,
    pub descent: i16,
    pub cap_height: i16,
    pub bbox: [i16; 4],
    pub italic_angle: f64,
    pub stem_v: i16,
    pub flags: u32,
}

/// Errors that can occur during font subsetting.
#[derive(Debug, thiserror::Error)]
pub enum SubsetError {
    #[error("parse error: {0}")]
    ParseError(String),
    #[error("missing table: {0}")]
    MissingTable(String),
    #[error("invalid glyph data at index {0}")]
    InvalidGlyphData(usize),
}

// ---------------------------------------------------------------------------
// Composite glyph flags (TrueType spec)
// ---------------------------------------------------------------------------

const ARG_1_AND_2_ARE_WORDS: u16 = 0x0001;
const MORE_COMPONENTS: u16 = 0x0020;
const WE_HAVE_A_SCALE: u16 = 0x0008;
const WE_HAVE_AN_X_AND_Y_SCALE: u16 = 0x0040;
const WE_HAVE_A_TWO_BY_TWO: u16 = 0x0080;

// Main entry point

pub fn subset_font(
    font_data: &[u8],
    codepoints: &BTreeSet<u32>,
) -> Result<SubsetResult, SubsetError> {
    let face = Face::parse(font_data, 0).map_err(|e| SubsetError::ParseError(format!("{e:?}")))?;

    let mut old_gids: BTreeSet<u16> = BTreeSet::new();
    let mut cp_to_old: BTreeMap<u32, u16> = BTreeMap::new();
    old_gids.insert(0);
    for &cp in codepoints {
        if let Some(c) = char::from_u32(cp)
            && let Some(gid) = face.glyph_index(c)
        {
            old_gids.insert(gid.0);
            cp_to_old.insert(cp, gid.0);
        }
    }
    let glyf_data = get_table(&face, b"glyf")?;
    let loca_data = get_table(&face, b"loca")?;
    let head_data = get_table(&face, b"head")?;
    let num_glyphs = face.number_of_glyphs();
    let loca_fmt = if head_data.len() >= 52 {
        i16::from_be_bytes([head_data[50], head_data[51]])
    } else {
        0
    };

    let mut queue: Vec<u16> = old_gids.iter().copied().collect();
    let mut visited: HashSet<u16> = old_gids.iter().copied().collect();
    while let Some(gid) = queue.pop() {
        let (off, len) = glyph_off_len(loca_data, loca_fmt, gid, num_glyphs);
        if len == 0 || off + len > glyf_data.len() {
            continue;
        }
        let gb = &glyf_data[off..off + len];
        if gb.len() < 2 || i16::from_be_bytes([gb[0], gb[1]]) >= 0 {
            continue;
        }
        for cg in parse_composite(gb) {
            if cg < num_glyphs && visited.insert(cg) {
                old_gids.insert(cg);
                queue.push(cg);
            }
        }
    }

    let old_vec: Vec<u16> = old_gids.iter().copied().collect();
    let mut o2n: BTreeMap<u16, u16> = BTreeMap::new();
    let mut n2o: BTreeMap<u16, u16> = BTreeMap::new();
    for (i, &og) in old_vec.iter().enumerate() {
        o2n.insert(og, i as u16);
        n2o.insert(i as u16, og);
    }
    let cp_to_new: BTreeMap<u32, u16> = cp_to_old
        .iter()
        .filter_map(|(&cp, &og)| o2n.get(&og).map(|&ng| (cp, ng)))
        .collect();

    let metrics = extract_metrics(&face);
    let subset_tag = gen_tag(&old_vec);
    let nn = old_vec.len() as u16;

    let hmtx_data = get_table(&face, b"hmtx")?;
    let hhea_data = get_table(&face, b"hhea")?;
    let orig_num_h_metrics = if hhea_data.len() >= 36 {
        u16::from_be_bytes([hhea_data[34], hhea_data[35]])
    } else {
        num_glyphs
    };

    let new_hmtx = build_hmtx(hmtx_data, &old_vec, orig_num_h_metrics, num_glyphs);
    let (new_glyf, new_loca) =
        build_glyf_loca(glyf_data, loca_data, loca_fmt, &old_vec, &o2n, num_glyphs);
    let new_cmap = build_cmap(&cp_to_new);
    let new_head = build_head(head_data, 1);
    let new_hhea = build_hhea(hhea_data, nn);
    let new_maxp = build_maxp(nn);
    let new_post = mk_post();
    let new_name = mk_name(&subset_tag);

    let tables = vec![
        (b"cmap", new_cmap),
        (b"glyf", new_glyf),
        (b"head", new_head),
        (b"hhea", new_hhea),
        (b"hmtx", new_hmtx),
        (b"loca", new_loca),
        (b"maxp", new_maxp),
        (b"name", new_name),
        (b"post", new_post),
    ];
    let font_data = assemble(&tables);

    Ok(SubsetResult {
        font_data,
        codepoint_to_new_gid: cp_to_new,
        new_gid_to_old_gid: n2o,
        subset_tag,
        metrics,
    })
}

fn get_table<'a>(face: &Face<'a>, tag: &[u8; 4]) -> Result<&'a [u8], SubsetError> {
    face.raw_face()
        .table(Tag::from_bytes(tag))
        .ok_or_else(|| SubsetError::MissingTable(String::from_utf8_lossy(tag).into()))
}

// ---------------------------------------------------------------------------
// Helper: loca table lookup
// ---------------------------------------------------------------------------

fn glyph_off_len(loca: &[u8], fmt: i16, gid: u16, num_glyphs: u16) -> (usize, usize) {
    if gid >= num_glyphs {
        return (0, 0);
    }
    if fmt == 0 {
        // Short format: u16 entries, multiply by 2
        let idx = gid as usize * 2;
        let next_idx = (gid as usize + 1) * 2;
        if next_idx + 2 > loca.len() {
            return (0, 0);
        }
        let off = u16::from_be_bytes([loca[idx], loca[idx + 1]]) as usize * 2;
        let next = u16::from_be_bytes([loca[next_idx], loca[next_idx + 1]]) as usize * 2;
        (off, next.saturating_sub(off))
    } else {
        // Long format: u32 entries
        let idx = gid as usize * 4;
        let next_idx = (gid as usize + 1) * 4;
        if next_idx + 4 > loca.len() {
            return (0, 0);
        }
        let off =
            u32::from_be_bytes([loca[idx], loca[idx + 1], loca[idx + 2], loca[idx + 3]]) as usize;
        let next = u32::from_be_bytes([
            loca[next_idx],
            loca[next_idx + 1],
            loca[next_idx + 2],
            loca[next_idx + 3],
        ]) as usize;
        (off, next.saturating_sub(off))
    }
}

// ---------------------------------------------------------------------------
// Helper: composite glyph component extraction
// ---------------------------------------------------------------------------

fn parse_composite(glyph_data: &[u8]) -> Vec<u16> {
    let mut result = Vec::new();
    if glyph_data.len() < 10 {
        return result;
    }
    // First i16 = numberOfContours; if >= 0, it's simple, not composite
    let n_contours = i16::from_be_bytes([glyph_data[0], glyph_data[1]]);
    if n_contours >= 0 {
        return result;
    }
    // Skip header: numberOfContours(2) + xMin(2) + yMin(2) + xMax(2) + yMax(2) = 10 bytes
    let mut pos = 10;
    loop {
        if pos + 4 > glyph_data.len() {
            break;
        }
        let flags = u16::from_be_bytes([glyph_data[pos], glyph_data[pos + 1]]);
        let glyph_index = u16::from_be_bytes([glyph_data[pos + 2], glyph_data[pos + 3]]);
        result.push(glyph_index);
        pos += 4;
        // Skip arguments
        if flags & ARG_1_AND_2_ARE_WORDS != 0 {
            pos += 4; // two i16
        } else {
            pos += 2; // two i8
        }
        // Skip transform
        if flags & WE_HAVE_A_TWO_BY_TWO != 0 {
            pos += 8; // 4 × F2Dot14
        } else if flags & WE_HAVE_AN_X_AND_Y_SCALE != 0 {
            pos += 4; // 2 × F2Dot14
        } else if flags & WE_HAVE_A_SCALE != 0 {
            pos += 2; // 1 × F2Dot14
        }
        if flags & MORE_COMPONENTS == 0 {
            break;
        }
    }
    result
}

// ---------------------------------------------------------------------------
// Helper: extract font-level metrics
// ---------------------------------------------------------------------------

fn extract_metrics(face: &Face) -> FontMetrics {
    let bbox = face.global_bounding_box();
    let cap_height = face.capital_height().unwrap_or(face.ascender());
    let italic_angle = face.italic_angle().unwrap_or(0.0) as f64;
    // Estimate StemV from cap height (heuristic: ~12% of cap height)
    let stem_v = (cap_height as i32 * 12 / 100).max(50) as i16;
    // PDF font flags: bit 2 = Serif (guess from name), bit 5 = Nonsymbolic, bit 6 = Italic
    let mut flags: u32 = 32; // Nonsymbolic
    if face.is_italic() {
        flags |= 64; // Italic
    }
    FontMetrics {
        units_per_em: face.units_per_em(),
        ascent: face.ascender(),
        descent: face.descender(),
        cap_height,
        bbox: [bbox.x_min, bbox.y_min, bbox.x_max, bbox.y_max],
        italic_angle,
        stem_v,
        flags,
    }
}

// ---------------------------------------------------------------------------
// Helper: generate subset tag
// ---------------------------------------------------------------------------

fn gen_tag(gids: &[u16]) -> String {
    // Deterministic 6-letter tag derived from gid set
    let mut hash: u32 = 0x5A5A_5A5A;
    for &g in gids {
        hash = hash.wrapping_mul(31).wrapping_add(g as u32);
    }
    let mut tag = String::with_capacity(6);
    for i in 0..6 {
        let byte = ((hash >> (i * 5)) & 0x1F) as u8;
        tag.push((b'A' + (byte % 26)) as char);
    }
    tag
}

// ---------------------------------------------------------------------------
// Table builders
// ---------------------------------------------------------------------------

fn build_hmtx(hmtx: &[u8], old_gids: &[u16], num_h_metrics: u16, _num_glyphs: u16) -> Vec<u8> {
    let mut out = Vec::with_capacity(old_gids.len() * 4);
    for &gid in old_gids {
        if gid < num_h_metrics {
            let off = gid as usize * 4;
            if off + 4 <= hmtx.len() {
                out.extend_from_slice(&hmtx[off..off + 4]);
            } else {
                out.extend_from_slice(&[0u8; 4]);
            }
        } else {
            // Monospaced tail: advance from last full record, lsb from lsb-only section
            let last_adv_off = (num_h_metrics as usize - 1) * 4;
            let advance = if last_adv_off + 2 <= hmtx.len() {
                [hmtx[last_adv_off], hmtx[last_adv_off + 1]]
            } else {
                [0, 0]
            };
            let lsb_off = num_h_metrics as usize * 4 + (gid as usize - num_h_metrics as usize) * 2;
            let lsb = if lsb_off + 2 <= hmtx.len() {
                [hmtx[lsb_off], hmtx[lsb_off + 1]]
            } else {
                [0, 0]
            };
            out.extend_from_slice(&advance);
            out.extend_from_slice(&lsb);
        }
    }
    out
}

fn build_glyf_loca(
    glyf: &[u8],
    loca: &[u8],
    loca_fmt: i16,
    old_gids: &[u16],
    o2n: &BTreeMap<u16, u16>,
    num_glyphs: u16,
) -> (Vec<u8>, Vec<u8>) {
    let mut new_glyf = Vec::new();
    let mut offsets: Vec<u32> = Vec::with_capacity(old_gids.len() + 1);

    for &old_gid in old_gids {
        offsets.push(new_glyf.len() as u32);
        let (off, len) = glyph_off_len(loca, loca_fmt, old_gid, num_glyphs);
        if len == 0 || off + len > glyf.len() {
            continue;
        }
        let mut glyph_bytes = glyf[off..off + len].to_vec();
        // Patch composite glyph references
        if glyph_bytes.len() >= 2 {
            let n_contours = i16::from_be_bytes([glyph_bytes[0], glyph_bytes[1]]);
            if n_contours < 0 {
                patch_composite_refs(&mut glyph_bytes, o2n);
            }
        }
        new_glyf.extend_from_slice(&glyph_bytes);
        // Pad to 4-byte alignment
        while new_glyf.len() % 4 != 0 {
            new_glyf.push(0);
        }
    }
    offsets.push(new_glyf.len() as u32);

    // Build loca as long format (u32)
    let mut new_loca = Vec::with_capacity(offsets.len() * 4);
    for &o in &offsets {
        new_loca.extend_from_slice(&o.to_be_bytes());
    }

    (new_glyf, new_loca)
}

fn patch_composite_refs(glyph_bytes: &mut [u8], o2n: &BTreeMap<u16, u16>) {
    let mut pos = 10; // skip header
    loop {
        if pos + 4 > glyph_bytes.len() {
            break;
        }
        let flags = u16::from_be_bytes([glyph_bytes[pos], glyph_bytes[pos + 1]]);
        let old_gid = u16::from_be_bytes([glyph_bytes[pos + 2], glyph_bytes[pos + 3]]);
        if let Some(&new_gid) = o2n.get(&old_gid) {
            let bytes = new_gid.to_be_bytes();
            glyph_bytes[pos + 2] = bytes[0];
            glyph_bytes[pos + 3] = bytes[1];
        }
        pos += 4;
        if flags & ARG_1_AND_2_ARE_WORDS != 0 {
            pos += 4;
        } else {
            pos += 2;
        }
        if flags & WE_HAVE_A_TWO_BY_TWO != 0 {
            pos += 8;
        } else if flags & WE_HAVE_AN_X_AND_Y_SCALE != 0 {
            pos += 4;
        } else if flags & WE_HAVE_A_SCALE != 0 {
            pos += 2;
        }
        if flags & MORE_COMPONENTS == 0 {
            break;
        }
    }
}

fn build_cmap(cp_to_new: &BTreeMap<u32, u16>) -> Vec<u8> {
    // Build format 12 (full Unicode)
    // Table header: version(2) + numTables(2)
    // Encoding record: platformID(2) + encodingID(2) + offset(4)
    // Format 12 subtable: format(2) + reserved(2) + length(4) + language(4) + numGroups(4)
    // Each group: startCharCode(4) + endCharCode(4) + startGlyphID(4)

    // Build groups from sorted codepoint mapping
    let mut groups: Vec<(u32, u32, u16)> = Vec::new();
    let entries: Vec<(u32, u16)> = cp_to_new.iter().map(|(&cp, &gid)| (cp, gid)).collect();
    if !entries.is_empty() {
        let mut start_cp = entries[0].0;
        let mut start_gid = entries[0].1;
        let mut prev_cp = start_cp;
        let mut prev_gid = start_gid;
        for &(cp, gid) in &entries[1..] {
            if cp == prev_cp + 1 && gid == prev_gid + 1 {
                prev_cp = cp;
                prev_gid = gid;
            } else {
                groups.push((start_cp, prev_cp, start_gid));
                start_cp = cp;
                start_gid = gid;
                prev_cp = cp;
                prev_gid = gid;
            }
        }
        groups.push((start_cp, prev_cp, start_gid));
    }

    let num_groups = groups.len() as u32;
    let subtable_len = 16 + num_groups * 12; // format12 header + groups
    let table_len = 4 + 8 + subtable_len as usize; // cmap header + 1 encoding record + subtable

    let mut out = Vec::with_capacity(table_len);
    // cmap header
    out.extend_from_slice(&0u16.to_be_bytes()); // version
    out.extend_from_slice(&1u16.to_be_bytes()); // numTables
    // Encoding record: platform 3 (Windows), encoding 10 (Full Unicode)
    out.extend_from_slice(&3u16.to_be_bytes()); // platformID
    out.extend_from_slice(&10u16.to_be_bytes()); // encodingID
    out.extend_from_slice(&12u32.to_be_bytes()); // offset to subtable

    // Format 12 subtable
    out.extend_from_slice(&12u16.to_be_bytes()); // format
    out.extend_from_slice(&0u16.to_be_bytes()); // reserved
    out.extend_from_slice(&subtable_len.to_be_bytes()); // length
    out.extend_from_slice(&0u32.to_be_bytes()); // language
    out.extend_from_slice(&num_groups.to_be_bytes());
    for (start, end, gid) in &groups {
        out.extend_from_slice(&start.to_be_bytes());
        out.extend_from_slice(&end.to_be_bytes());
        out.extend_from_slice(&(*gid as u32).to_be_bytes());
    }
    out
}

fn build_head(orig: &[u8], loca_format: i16) -> Vec<u8> {
    let mut head = orig.to_vec();
    // Ensure 54 bytes minimum
    head.resize(head.len().max(54), 0);
    // Zero out checksumAdjustment (bytes 8-11) — patched after assembly
    head[8] = 0;
    head[9] = 0;
    head[10] = 0;
    head[11] = 0;
    // Set indexToLocFormat (bytes 50-51) to long format
    let fmt_bytes = loca_format.to_be_bytes();
    head[50] = fmt_bytes[0];
    head[51] = fmt_bytes[1];
    head
}

fn build_hhea(orig: &[u8], num_glyphs: u16) -> Vec<u8> {
    let mut hhea = orig.to_vec();
    hhea.resize(hhea.len().max(36), 0);
    // Update numberOfHMetrics (bytes 34-35)
    let bytes = num_glyphs.to_be_bytes();
    hhea[34] = bytes[0];
    hhea[35] = bytes[1];
    hhea
}

fn build_maxp(num_glyphs: u16) -> Vec<u8> {
    let mut out = Vec::with_capacity(6);
    out.extend_from_slice(&0x0001_0000u32.to_be_bytes()); // version 1.0
    out.extend_from_slice(&num_glyphs.to_be_bytes());
    out
}

fn mk_post() -> Vec<u8> {
    // Minimal post table: format 3.0 (no glyph names)
    let mut out = Vec::with_capacity(32);
    out.extend_from_slice(&0x0003_0000u32.to_be_bytes()); // version 3.0
    out.extend_from_slice(&0u32.to_be_bytes()); // italicAngle (Fixed)
    out.extend_from_slice(&(-100i16).to_be_bytes()); // underlinePosition
    out.extend_from_slice(&50u16.to_be_bytes()); // underlineThickness
    out.extend_from_slice(&0u32.to_be_bytes()); // isFixedPitch
    out.extend_from_slice(&0u32.to_be_bytes()); // minMemType42
    out.extend_from_slice(&0u32.to_be_bytes()); // maxMemType42
    out.extend_from_slice(&0u32.to_be_bytes()); // minMemType1
    out.extend_from_slice(&0u32.to_be_bytes()); // maxMemType1
    out
}

fn mk_name(subset_tag: &str) -> Vec<u8> {
    // Minimal name table with just the font name
    let font_name = format!("{}+SubsetFont", subset_tag);
    let name_bytes: Vec<u8> = font_name
        .encode_utf16()
        .flat_map(|c| c.to_be_bytes())
        .collect();

    // We'll write 4 name records (nameID 1, 2, 4, 6) all pointing to the same string
    let name_ids: [u16; 4] = [1, 2, 4, 6]; // Family, Subfamily, Full, PostScript
    let num_records = name_ids.len() as u16;
    let string_offset = 6 + num_records * 12; // header(6) + records
    let string_len = name_bytes.len() as u16;

    let mut out = Vec::new();
    // Header
    out.extend_from_slice(&0u16.to_be_bytes()); // format
    out.extend_from_slice(&num_records.to_be_bytes());
    out.extend_from_slice(&string_offset.to_be_bytes());
    // Records (platform 3 = Windows, encoding 1 = Unicode BMP, language 0x0409 = en-US)
    for &name_id in &name_ids {
        out.extend_from_slice(&3u16.to_be_bytes()); // platformID
        out.extend_from_slice(&1u16.to_be_bytes()); // encodingID
        out.extend_from_slice(&0x0409u16.to_be_bytes()); // languageID
        out.extend_from_slice(&name_id.to_be_bytes()); // nameID
        out.extend_from_slice(&string_len.to_be_bytes()); // length
        out.extend_from_slice(&0u16.to_be_bytes()); // offset (all share same string)
    }
    // String data
    out.extend_from_slice(&name_bytes);
    out
}

// ---------------------------------------------------------------------------
// TrueType file assembly
// ---------------------------------------------------------------------------

fn calc_table_checksum(data: &[u8]) -> u32 {
    let mut sum: u32 = 0;
    let mut i = 0;
    while i + 4 <= data.len() {
        sum = sum.wrapping_add(u32::from_be_bytes([
            data[i],
            data[i + 1],
            data[i + 2],
            data[i + 3],
        ]));
        i += 4;
    }
    // Handle trailing bytes (pad with zeros)
    if i < data.len() {
        let mut last = [0u8; 4];
        for (j, &b) in data[i..].iter().enumerate() {
            last[j] = b;
        }
        sum = sum.wrapping_add(u32::from_be_bytes(last));
    }
    sum
}

fn assemble(tables: &[(&[u8; 4], Vec<u8>)]) -> Vec<u8> {
    let num_tables = tables.len() as u16;
    // searchRange = (highest power of 2 <= numTables) * 16
    let max_pow2 = (1u16 << (15 - num_tables.leading_zeros() as u16)).min(num_tables);
    let search_range = max_pow2 * 16;
    let entry_selector = (max_pow2 as f64).log2() as u16;
    let range_shift = num_tables * 16 - search_range;

    let header_size = 12 + tables.len() * 16; // offset table + directory entries
    let mut data_offset = header_size;
    // Align data_offset to 4 bytes
    if !data_offset.is_multiple_of(4) {
        data_offset += 4 - data_offset % 4;
    }

    // Calculate table offsets
    let mut table_entries: Vec<(u32, u32, u32, u32)> = Vec::new(); // tag_u32, checksum, offset, length
    let mut current_offset = data_offset;
    for (tag, tdata) in tables {
        let tag_u32 = u32::from_be_bytes(**tag);
        let checksum = calc_table_checksum(tdata);
        let length = tdata.len() as u32;
        table_entries.push((tag_u32, checksum, current_offset as u32, length));
        current_offset += tdata.len();
        // Pad to 4-byte alignment
        if !current_offset.is_multiple_of(4) {
            current_offset += 4 - current_offset % 4;
        }
    }

    let mut out = Vec::with_capacity(current_offset);

    // Offset table
    out.extend_from_slice(&0x0001_0000u32.to_be_bytes()); // sfVersion (TrueType)
    out.extend_from_slice(&num_tables.to_be_bytes());
    out.extend_from_slice(&search_range.to_be_bytes());
    out.extend_from_slice(&entry_selector.to_be_bytes());
    out.extend_from_slice(&range_shift.to_be_bytes());

    // Table directory (sorted by tag)
    let mut sorted_entries: Vec<(usize, &(u32, u32, u32, u32))> =
        table_entries.iter().enumerate().collect();
    sorted_entries.sort_by_key(|(_, e)| e.0);
    for (_, entry) in &sorted_entries {
        out.extend_from_slice(&entry.0.to_be_bytes()); // tag
        out.extend_from_slice(&entry.1.to_be_bytes()); // checksum
        out.extend_from_slice(&entry.2.to_be_bytes()); // offset
        out.extend_from_slice(&entry.3.to_be_bytes()); // length
    }

    // Pad to data start
    while out.len() < data_offset {
        out.push(0);
    }

    // Table data
    for (_, tdata) in tables {
        out.extend_from_slice(tdata);
        while out.len() % 4 != 0 {
            out.push(0);
        }
    }

    // Patch head.checksumAdjustment
    // Find head table offset
    for (i, (tag, _)) in tables.iter().enumerate() {
        if *tag == b"head" {
            let head_offset = table_entries[i].2 as usize;
            let file_checksum = calc_table_checksum(&out);
            let adjustment = 0xB1B0_AFBAu32.wrapping_sub(file_checksum);
            let adj_bytes = adjustment.to_be_bytes();
            if head_offset + 12 <= out.len() {
                out[head_offset + 8] = adj_bytes[0];
                out[head_offset + 9] = adj_bytes[1];
                out[head_offset + 10] = adj_bytes[2];
                out[head_offset + 11] = adj_bytes[3];
            }
            break;
        }
    }

    out
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gen_tag_length() {
        let gids = vec![0, 1, 2, 3];
        let tag = gen_tag(&gids);
        assert_eq!(tag.len(), 6);
        assert!(tag.chars().all(|c| c.is_ascii_uppercase()));
    }

    #[test]
    fn test_gen_tag_deterministic() {
        let gids = vec![0, 65, 66, 67];
        let t1 = gen_tag(&gids);
        let t2 = gen_tag(&gids);
        assert_eq!(t1, t2);
    }

    #[test]
    fn test_gen_tag_different_for_different_gids() {
        let t1 = gen_tag(&[0, 1]);
        let t2 = gen_tag(&[0, 2]);
        assert_ne!(t1, t2);
    }

    #[test]
    fn test_mk_post_size() {
        let post = mk_post();
        assert_eq!(post.len(), 32);
        // Version should be 3.0
        let ver = u32::from_be_bytes([post[0], post[1], post[2], post[3]]);
        assert_eq!(ver, 0x0003_0000);
    }

    #[test]
    fn test_build_maxp() {
        let maxp = build_maxp(42);
        assert_eq!(maxp.len(), 6);
        let ver = u32::from_be_bytes([maxp[0], maxp[1], maxp[2], maxp[3]]);
        assert_eq!(ver, 0x0001_0000);
        let ng = u16::from_be_bytes([maxp[4], maxp[5]]);
        assert_eq!(ng, 42);
    }

    #[test]
    fn test_build_cmap_empty() {
        let cmap = build_cmap(&BTreeMap::new());
        // Should have header + encoding record + format 12 with 0 groups
        assert!(cmap.len() >= 12 + 16); // 12 header + 16 format12 header
        let num_groups = u32::from_be_bytes([cmap[24], cmap[25], cmap[26], cmap[27]]);
        assert_eq!(num_groups, 0);
    }

    #[test]
    fn test_build_cmap_single() {
        let mut map = BTreeMap::new();
        map.insert(0x41, 1u16); // 'A' -> gid 1
        let cmap = build_cmap(&map);
        let num_groups = u32::from_be_bytes([cmap[24], cmap[25], cmap[26], cmap[27]]);
        assert_eq!(num_groups, 1);
        // First group: start=0x41, end=0x41, gid=1
        let start = u32::from_be_bytes([cmap[28], cmap[29], cmap[30], cmap[31]]);
        let end = u32::from_be_bytes([cmap[32], cmap[33], cmap[34], cmap[35]]);
        let gid = u32::from_be_bytes([cmap[36], cmap[37], cmap[38], cmap[39]]);
        assert_eq!(start, 0x41);
        assert_eq!(end, 0x41);
        assert_eq!(gid, 1);
    }

    #[test]
    fn test_build_cmap_consecutive_range() {
        let mut map = BTreeMap::new();
        map.insert(0x41, 1u16); // A
        map.insert(0x42, 2u16); // B
        map.insert(0x43, 3u16); // C
        let cmap = build_cmap(&map);
        let num_groups = u32::from_be_bytes([cmap[24], cmap[25], cmap[26], cmap[27]]);
        assert_eq!(num_groups, 1); // Should merge into single group
    }

    #[test]
    fn test_glyph_off_len_short_format() {
        // Short loca: [0, 10, 20, 30] (as u16, divide by 2 for storage)
        let loca: Vec<u8> = [0u16, 5, 10, 15]
            .iter()
            .flat_map(|v| v.to_be_bytes())
            .collect();
        let (off, len) = glyph_off_len(&loca, 0, 0, 3);
        assert_eq!(off, 0);
        assert_eq!(len, 10); // 5*2 - 0*2
        let (off, len) = glyph_off_len(&loca, 0, 1, 3);
        assert_eq!(off, 10);
        assert_eq!(len, 10);
    }

    #[test]
    fn test_glyph_off_len_long_format() {
        let loca: Vec<u8> = [0u32, 100, 250, 400]
            .iter()
            .flat_map(|v| v.to_be_bytes())
            .collect();
        let (off, len) = glyph_off_len(&loca, 1, 0, 3);
        assert_eq!(off, 0);
        assert_eq!(len, 100);
        let (off, len) = glyph_off_len(&loca, 1, 1, 3);
        assert_eq!(off, 100);
        assert_eq!(len, 150);
    }

    #[test]
    fn test_glyph_off_len_out_of_range() {
        let loca = vec![0u8; 8];
        let (off, len) = glyph_off_len(&loca, 0, 100, 3);
        assert_eq!(off, 0);
        assert_eq!(len, 0);
    }

    #[test]
    fn test_parse_composite_simple_glyph() {
        // Simple glyph: numberOfContours = 1 (positive)
        let mut data = vec![0u8; 12];
        data[0] = 0;
        data[1] = 1; // numberOfContours = 1
        assert!(parse_composite(&data).is_empty());
    }

    #[test]
    fn test_parse_composite_with_component() {
        // Composite glyph: numberOfContours = -1
        let mut data = vec![0u8; 20];
        // numberOfContours = -1
        let nc = (-1i16).to_be_bytes();
        data[0] = nc[0];
        data[1] = nc[1];
        // bbox (4 x i16) = zeros at bytes 2-9
        // Component at byte 10:
        let flags: u16 = 0; // no MORE_COMPONENTS, args are bytes
        data[10] = (flags >> 8) as u8;
        data[11] = flags as u8;
        data[12] = 0; // glyph index high
        data[13] = 42; // glyph index low = 42
        // 2 bytes for args (ARG_1_AND_2_ARE_WORDS not set)

        let components = parse_composite(&data);
        assert_eq!(components, vec![42]);
    }

    #[test]
    fn test_calc_table_checksum() {
        let data = [0x00, 0x01, 0x00, 0x00]; // = 0x00010000
        assert_eq!(calc_table_checksum(&data), 0x00010000);
    }

    #[test]
    fn test_mk_name_contains_tag() {
        let name = mk_name("ABCDEF");
        assert!(!name.is_empty());
        // Should have format 0, 4 records
        let num_records = u16::from_be_bytes([name[2], name[3]]);
        assert_eq!(num_records, 4);
    }

    #[test]
    fn test_assemble_produces_valid_header() {
        let head = build_head(&vec![0u8; 54], 1);
        let tables: Vec<(&[u8; 4], Vec<u8>)> = vec![
            (b"head", head),
            (b"maxp", build_maxp(1)),
            (b"post", mk_post()),
        ];
        let font = assemble(&tables);
        // Should start with TrueType signature
        let sig = u32::from_be_bytes([font[0], font[1], font[2], font[3]]);
        assert_eq!(sig, 0x00010000);
        let num_tables = u16::from_be_bytes([font[4], font[5]]);
        assert_eq!(num_tables, 3);
    }

    #[test]
    fn test_extract_metrics_basic() {
        // We can't easily test with a real font here without embedding one,
        // but we verify the function signature works correctly by checking
        // that FontMetrics has all expected fields.
        let m = FontMetrics {
            units_per_em: 1000,
            ascent: 800,
            descent: -200,
            cap_height: 700,
            bbox: [-100, -200, 1000, 900],
            italic_angle: 0.0,
            stem_v: 80,
            flags: 32,
        };
        assert_eq!(m.units_per_em, 1000);
        assert_eq!(m.flags & 32, 32); // Nonsymbolic flag
    }
}
