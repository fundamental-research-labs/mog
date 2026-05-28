use crate::write::xml_writer::XmlWriter;

use super::attrs::{RELATIONSHIPS_NS, SPREADSHEET_NS};
use super::writer::WorkbookWriter;

pub(super) fn write_workbook(writer: &WorkbookWriter) -> Vec<u8> {
    let mut w = XmlWriter::new();

    w.write_declaration();

    w.start_element("workbook")
        .attr("xmlns", SPREADSHEET_NS)
        .attr("xmlns:r", RELATIONSHIPS_NS);

    if let Some(ref ns) = writer.root_namespaces {
        use crate::write::mc_builder::McIgnorableBuilder;

        let mut mc_builder = McIgnorableBuilder::new();
        mc_builder.add_from_namespace_map(ns);

        if !mc_builder.is_empty() {
            w.attr(
                "xmlns:mc",
                "http://schemas.openxmlformats.org/markup-compatibility/2006",
            );
            if let Some(ignorable) = mc_builder.build() {
                w.attr("mc:Ignorable", &ignorable);
            }
        }

        for decl in ns.all() {
            if let Some(ref prefix) = decl.prefix {
                if prefix != "r" && prefix != "mc" {
                    w.attr(&format!("xmlns:{}", prefix), &decl.uri);
                }
            }
        }
    }

    w.end_attrs();

    super::metadata::write_file_version(&mut w, writer.file_version.as_ref());
    super::metadata::write_file_sharing(&mut w, writer.file_sharing.as_ref());
    super::metadata::write_workbook_properties(&mut w, writer.workbook_properties.as_ref());
    super::views::write_book_views(&mut w, &writer.workbook_views);
    super::sheets::write_sheets(&mut w, &writer.sheets);

    if let Some(ref prot) = writer.workbook_protection {
        use crate::domain::protection::write::WorkbookProtectionWrite;
        let ooxml_prot: ooxml_types::protection::WorkbookProtection = prot.clone().into();
        ooxml_prot.write_to(&mut w);
    }

    super::external::write_external_references(&mut w, &writer.external_reference_r_ids);
    super::defined_names::write_defined_names(&mut w, &writer.defined_names);
    super::calc::write_calc_settings(&mut w, writer.calc_settings.as_ref());

    if let Some(ref pivot_caches) = writer.pivot_caches_xml {
        w.raw_str(pivot_caches);
    }

    super::metadata::write_web_publishing(&mut w, writer.web_publishing.as_ref());

    if !writer.ext_lst_entries.is_empty() {
        w.start_element("extLst").end_attrs();
        for ext in &writer.ext_lst_entries {
            w.raw_str(ext);
        }
        w.end_element("extLst");
    }

    w.end_element("workbook");

    w.finish()
}
