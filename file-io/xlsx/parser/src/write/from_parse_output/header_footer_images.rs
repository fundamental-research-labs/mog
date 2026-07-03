use domain_types::domain::print::{
    HeaderFooterImageInfo, HfImagePosition as DomainHfImagePosition,
};

use crate::domain::print::hf_images::{HeaderFooterImage, HfImagePosition, ParsedHfVml};

pub(super) struct HeaderFooterImageExport {
    pub(super) vml: Option<ParsedHfVml>,
    pub(super) image_blobs: Vec<(String, Vec<u8>)>,
}

pub(super) fn build_header_footer_image_export(
    sheet_idx: usize,
    images: &[HeaderFooterImageInfo],
) -> HeaderFooterImageExport {
    let mut hf_images = Vec::new();
    let mut image_targets = Vec::new();
    let mut image_blobs = Vec::new();

    for (idx, image) in images.iter().enumerate() {
        let Some((extension, bytes)) =
            crate::write::drawing_writer_helpers::parse_data_url(&image.src)
        else {
            continue;
        };
        let relationship_id = format!("rId{}", idx + 1);
        let zip_path = format!(
            "xl/media/headerFooterImage{}_{}.{}",
            sheet_idx + 1,
            idx + 1,
            extension
        );
        let target = format!(
            "../media/headerFooterImage{}_{}.{}",
            sheet_idx + 1,
            idx + 1,
            extension
        );

        hf_images.push(HeaderFooterImage {
            position: map_position(image.position),
            image_rel_id: relationship_id.clone(),
            title: image.title.clone(),
            width_pt: image.width_pt,
            height_pt: image.height_pt,
        });
        image_targets.push((relationship_id, target));
        image_blobs.push((zip_path, bytes));
    }

    let vml = (!hf_images.is_empty()).then(|| ParsedHfVml {
        images: hf_images,
        image_targets,
        idmap_data: (sheet_idx + 1).to_string(),
        spid_base: 13_313 + (sheet_idx as u32 * 1_024),
        vml_path: format!("xl/drawings/vmlDrawingHF{}.vml", sheet_idx + 1),
        rels_path: None,
    });

    HeaderFooterImageExport { vml, image_blobs }
}

fn map_position(position: DomainHfImagePosition) -> HfImagePosition {
    match position {
        DomainHfImagePosition::LeftHeader => HfImagePosition::LeftHeader,
        DomainHfImagePosition::CenterHeader => HfImagePosition::CenterHeader,
        DomainHfImagePosition::RightHeader => HfImagePosition::RightHeader,
        DomainHfImagePosition::LeftFooter => HfImagePosition::LeftFooter,
        DomainHfImagePosition::CenterFooter => HfImagePosition::CenterFooter,
        DomainHfImagePosition::RightFooter => HfImagePosition::RightFooter,
    }
}
