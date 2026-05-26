//! PDF/A-2b compliance markers.
use crate::document::PdfDocument;
use crate::types::*;

pub struct PdfACompliance;

#[derive(Debug, Clone)]
pub struct PdfAWarning {
    pub code: String,
    pub message: String,
}

impl PdfACompliance {
    /// Add OutputIntent with embedded sRGB ICC profile.
    pub fn add_output_intent(doc: &mut PdfDocument) -> PdfRef {
        let icc_data = Self::srgb_icc_profile();
        let mut icc_dict = PdfDict::new();
        icc_dict.set("N", PdfValue::Integer(3));
        icc_dict.set("Alternate", PdfValue::name("DeviceRGB"));
        icc_dict.set("Length", PdfValue::Integer(icc_data.len() as i64));
        let icc_stream = PdfStream::with_dict(icc_data, icc_dict);
        let icc_ref = doc.add_object(PdfValue::Stream(icc_stream));
        let mut oi = PdfDict::new();
        oi.set("Type", PdfValue::name("OutputIntent"));
        oi.set("S", PdfValue::name("GTS_PDFA1"));
        oi.set(
            "OutputConditionIdentifier",
            PdfValue::text_string("sRGB IEC61966-2.1"),
        );
        oi.set("DestOutputProfile", PdfValue::Ref(icc_ref));
        doc.add_object(PdfValue::Dict(oi))
    }

    /// Generate a minimal sRGB ICC profile (ICC v2).
    pub fn srgb_icc_profile() -> Vec<u8> {
        let mut buf = Vec::new();
        // ICC v2 header (128 bytes)
        let mut header = [0u8; 128];
        // Preferred CMM type
        header[4..8].copy_from_slice(b"appl");
        // Version 2.1.0
        header[8] = 2;
        header[9] = 0x10;
        // Device class: mntr
        header[12..16].copy_from_slice(b"mntr");
        // Color space: RGB
        header[16..20].copy_from_slice(b"RGB ");
        // PCS: XYZ
        header[20..24].copy_from_slice(b"XYZ ");
        // Date: 2024-01-01
        header[24..26].copy_from_slice(&2024u16.to_be_bytes());
        header[26..28].copy_from_slice(&1u16.to_be_bytes());
        header[28..30].copy_from_slice(&1u16.to_be_bytes());
        // Signature: acsp
        header[36..40].copy_from_slice(b"acsp");
        // Primary platform: APPL
        header[40..44].copy_from_slice(b"APPL");
        // D50 illuminant XYZ
        let d50_x: u32 = 0x0000F6D6;
        let d50_y: u32 = 0x00010000;
        let d50_z: u32 = 0x0000D32D;
        header[68..72].copy_from_slice(&d50_x.to_be_bytes());
        header[72..76].copy_from_slice(&d50_y.to_be_bytes());
        header[76..80].copy_from_slice(&d50_z.to_be_bytes());

        buf.extend_from_slice(&header);

        // Tag table: 9 tags
        let tag_count: u32 = 9;
        buf.extend_from_slice(&tag_count.to_be_bytes());

        // Tag table entries: each is 12 bytes (sig, offset, size)
        // We will fill offsets and sizes after writing tag data.
        // Tags: desc, rXYZ, gXYZ, bXYZ, rTRC, gTRC, bTRC, wtpt, cprt
        let tag_table_start = buf.len();
        // Reserve space for 9 tag entries = 9 * 12 = 108 bytes
        buf.extend_from_slice(&[0u8; 108]);

        // Helper: XYZ type (20 bytes: sig "XYZ " + reserved 4 + 3x s15Fixed16)
        fn write_xyz(buf: &mut Vec<u8>, x: u32, y: u32, z: u32) -> (usize, usize) {
            let offset = buf.len();
            buf.extend_from_slice(b"XYZ ");
            buf.extend_from_slice(&[0u8; 4]); // reserved
            buf.extend_from_slice(&x.to_be_bytes());
            buf.extend_from_slice(&y.to_be_bytes());
            buf.extend_from_slice(&z.to_be_bytes());
            (offset, 20)
        }

        // Helper: curveType with gamma 2.2 (s15Fixed16)
        fn write_curve_gamma(buf: &mut Vec<u8>) -> (usize, usize) {
            let offset = buf.len();
            buf.extend_from_slice(b"curv");
            buf.extend_from_slice(&[0u8; 4]); // reserved
            buf.extend_from_slice(&1u32.to_be_bytes()); // count = 1 (parametric gamma)
            // gamma 2.2 as u8Fixed8: 2.2 * 256 = 563 = 0x0233
            buf.extend_from_slice(&0x0233u16.to_be_bytes());
            // Pad to 4-byte boundary
            buf.extend_from_slice(&[0u8; 2]);
            (offset, 14)
        }

        // Helper: desc type
        fn write_desc(buf: &mut Vec<u8>, text: &[u8]) -> (usize, usize) {
            let offset = buf.len();
            buf.extend_from_slice(b"desc");
            buf.extend_from_slice(&[0u8; 4]); // reserved
            // ASCII count (including null)
            let count = (text.len() + 1) as u32;
            buf.extend_from_slice(&count.to_be_bytes());
            buf.extend_from_slice(text);
            buf.push(0); // null terminator
            // Unicode count = 0, ScriptCode count = 0, Mac description
            buf.extend_from_slice(&0u32.to_be_bytes()); // unicode lang code
            buf.extend_from_slice(&0u32.to_be_bytes()); // unicode count
            buf.extend_from_slice(&0u16.to_be_bytes()); // scriptcode code
            buf.push(0); // scriptcode count
            buf.extend_from_slice(&[0u8; 67]); // mac description
            let size = buf.len() - offset;
            (offset, size)
        }

        // Helper: text type for copyright
        fn write_text(buf: &mut Vec<u8>, text: &[u8]) -> (usize, usize) {
            let offset = buf.len();
            buf.extend_from_slice(b"text");
            buf.extend_from_slice(&[0u8; 4]); // reserved
            buf.extend_from_slice(text);
            buf.push(0); // null terminator
            let size = buf.len() - offset;
            // Pad to 4-byte boundary
            while !buf.len().is_multiple_of(4) {
                buf.push(0);
            }
            (offset, size)
        }

        // Write tag data
        // sRGB primaries in s15Fixed16 (XYZ)
        // rXYZ: 0.4360, 0.2225, 0.0139
        let (r_xyz_off, r_xyz_sz) = write_xyz(&mut buf, 0x6FA2, 0x38F5, 0x0390);
        // gXYZ: 0.3851, 0.7169, 0.0971
        let (g_xyz_off, g_xyz_sz) = write_xyz(&mut buf, 0x6299, 0xB785, 0x18DA);
        // bXYZ: 0.1431, 0.0606, 0.7141
        let (b_xyz_off, b_xyz_sz) = write_xyz(&mut buf, 0x2493, 0x0F84, 0xB6CF);
        // wtpt (D65 white point): 0.9505, 1.0000, 1.0890
        let (wtpt_off, wtpt_sz) = write_xyz(&mut buf, 0xF351, 0x10000, 0x116CC);
        // rTRC, gTRC, bTRC: all gamma 2.2
        let (r_trc_off, r_trc_sz) = write_curve_gamma(&mut buf);
        let (g_trc_off, g_trc_sz) = write_curve_gamma(&mut buf);
        let (b_trc_off, b_trc_sz) = write_curve_gamma(&mut buf);
        // desc
        let (desc_off, desc_sz) = write_desc(&mut buf, b"sRGB IEC61966-2.1");
        // cprt
        let (cprt_off, cprt_sz) = write_text(&mut buf, b"Public Domain");

        // Fill in tag table entries
        let tags: [(&[u8; 4], usize, usize); 9] = [
            (b"desc", desc_off, desc_sz),
            (b"rXYZ", r_xyz_off, r_xyz_sz),
            (b"gXYZ", g_xyz_off, g_xyz_sz),
            (b"bXYZ", b_xyz_off, b_xyz_sz),
            (b"rTRC", r_trc_off, r_trc_sz),
            (b"gTRC", g_trc_off, g_trc_sz),
            (b"bTRC", b_trc_off, b_trc_sz),
            (b"wtpt", wtpt_off, wtpt_sz),
            (b"cprt", cprt_off, cprt_sz),
        ];
        for (i, (sig, offset, size)) in tags.iter().enumerate() {
            let pos = tag_table_start + i * 12;
            buf[pos..pos + 4].copy_from_slice(*sig);
            buf[pos + 4..pos + 8].copy_from_slice(&(*offset as u32).to_be_bytes());
            buf[pos + 8..pos + 12].copy_from_slice(&(*size as u32).to_be_bytes());
        }

        // Fix up profile size in header bytes 0..4
        let total_size = buf.len() as u32;
        buf[0..4].copy_from_slice(&total_size.to_be_bytes());

        buf
    }

    /// Build a /MarkInfo dictionary for tagged PDF.
    pub fn mark_info_dict() -> PdfDict {
        let mut d = PdfDict::new();
        d.set("Marked", PdfValue::Boolean(true));
        d
    }

    /// Validate basic PDF/A-2b requirements. Returns a list of warnings.
    pub fn validate(
        has_output_intent: bool,
        has_mark_info: bool,
        has_xmp_metadata: bool,
        has_structure_tree: bool,
    ) -> Vec<PdfAWarning> {
        let mut warnings = Vec::new();
        if !has_output_intent {
            warnings.push(PdfAWarning {
                code: "PDFA-OI".to_string(),
                message: "Missing OutputIntent with ICC profile".to_string(),
            });
        }
        if !has_mark_info {
            warnings.push(PdfAWarning {
                code: "PDFA-MI".to_string(),
                message: "Missing MarkInfo dictionary".to_string(),
            });
        }
        if !has_xmp_metadata {
            warnings.push(PdfAWarning {
                code: "PDFA-XMP".to_string(),
                message: "Missing XMP metadata stream".to_string(),
            });
        }
        if !has_structure_tree {
            warnings.push(PdfAWarning {
                code: "PDFA-ST".to_string(),
                message: "Missing structure tree for accessibility".to_string(),
            });
        }
        warnings
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::PdfDocument;

    #[test]
    fn test_srgb_icc_profile_valid() {
        let profile = PdfACompliance::srgb_icc_profile();
        // Must start with profile size
        let size = u32::from_be_bytes([profile[0], profile[1], profile[2], profile[3]]);
        assert_eq!(size as usize, profile.len());
        // Signature must be acsp
        assert_eq!(&profile[36..40], b"acsp");
        // Color space RGB
        assert_eq!(&profile[16..20], b"RGB ");
        // PCS XYZ
        assert_eq!(&profile[20..24], b"XYZ ");
        // Profile size should be at least 128 (header) + 4 (tag count) + some data
        assert!(profile.len() > 240);
    }

    #[test]
    fn test_srgb_icc_profile_tag_count() {
        let profile = PdfACompliance::srgb_icc_profile();
        let tag_count =
            u32::from_be_bytes([profile[128], profile[129], profile[130], profile[131]]);
        assert_eq!(tag_count, 9);
    }

    #[test]
    fn test_add_output_intent() {
        let mut doc = PdfDocument::new();
        let oi_ref = PdfACompliance::add_output_intent(&mut doc);
        let built = doc.build();
        let oi = built.objects.iter().find(|o| o.obj_ref == oi_ref).unwrap();
        if let PdfValue::Dict(ref d) = oi.value {
            assert_eq!(d.get_name("Type"), Some("OutputIntent"));
            assert_eq!(d.get_name("S"), Some("GTS_PDFA1"));
            assert!(d.get_ref("DestOutputProfile").is_some());
        } else {
            panic!("Expected dict");
        }
    }

    #[test]
    fn test_mark_info_dict() {
        let d = PdfACompliance::mark_info_dict();
        assert_eq!(d.get_boolean("Marked"), Some(true));
    }

    #[test]
    fn test_validate_all_present() {
        let warnings = PdfACompliance::validate(true, true, true, true);
        assert!(warnings.is_empty());
    }

    #[test]
    fn test_validate_all_missing() {
        let warnings = PdfACompliance::validate(false, false, false, false);
        assert_eq!(warnings.len(), 4);
        assert_eq!(warnings[0].code, "PDFA-OI");
        assert_eq!(warnings[1].code, "PDFA-MI");
        assert_eq!(warnings[2].code, "PDFA-XMP");
        assert_eq!(warnings[3].code, "PDFA-ST");
    }

    #[test]
    fn test_validate_partial() {
        let warnings = PdfACompliance::validate(true, false, true, false);
        assert_eq!(warnings.len(), 2);
        assert_eq!(warnings[0].code, "PDFA-MI");
        assert_eq!(warnings[1].code, "PDFA-ST");
    }
}
