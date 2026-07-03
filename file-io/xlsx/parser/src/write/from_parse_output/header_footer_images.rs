use domain_types::domain::print::{
    HeaderFooterImageInfo, HfImagePosition as DomainHfImagePosition,
};

use crate::domain::print::hf_images::{
    HeaderFooterImage, HeaderFooterImageTarget, HfImagePosition, ParsedHfVml,
};
use crate::write::package_graph::PackageGraphBuilder;
use crate::write::write_error::WriteError;

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
        let relationship_id = format!("rId{}", idx + 1);
        let hf_image = HeaderFooterImage {
            position: map_position(image.position),
            image_rel_id: relationship_id.clone(),
            title: image.title.clone(),
            width_pt: image.width_pt,
            height_pt: image.height_pt,
        };

        if crate::write::package_graph::is_external_target_mode(image.target_mode.as_deref()) {
            hf_images.push(hf_image);
            image_targets.push(HeaderFooterImageTarget {
                relationship_id,
                target: image.src.clone(),
                target_mode: image.target_mode.clone(),
            });
        } else if let Some((extension, bytes)) =
            crate::write::drawing_writer_helpers::parse_data_url(&image.src)
        {
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

            hf_images.push(hf_image);
            image_targets.push(HeaderFooterImageTarget {
                relationship_id,
                target,
                target_mode: None,
            });
            image_blobs.push((zip_path, bytes));
        }
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

pub(super) fn register_header_footer_image_relationships(
    package_graph_builder: &mut PackageGraphBuilder,
    hf: &ParsedHfVml,
) -> Result<(), WriteError> {
    for target in &hf.image_targets {
        if crate::write::package_graph::is_external_target_mode(target.target_mode.as_deref()) {
            crate::write::package_graph::register_drawing_relationship_with_target_mode(
                package_graph_builder,
                &hf.vml_path,
                crate::infra::opc::REL_IMAGE,
                &target.target,
                target.target_mode.as_deref(),
                &target.relationship_id,
            )?;
            continue;
        }

        let Ok(target_path) =
            crate::infra::opc::resolve_relationship_target(Some(&hf.vml_path), &target.target)
        else {
            continue;
        };
        if package_graph_builder.contains_part(&target_path) {
            crate::write::package_graph::register_part_image_relationship(
                package_graph_builder,
                &hf.vml_path,
                &target_path,
                &target.relationship_id,
            );
        }
    }
    Ok(())
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
