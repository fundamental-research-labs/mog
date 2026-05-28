use crate::write::xml_writer::XmlWriter;

use super::super::super::types::{DIAGRAM_GRAPHIC_DATA_URI, NS_DGM, SmartArtWriteData};
use super::super::DrawingWriter;

impl DrawingWriter {
    /// Write a SmartArt graphicFrame element (`<xdr:graphicFrame>`) with `<dgm:relIds>`.
    pub(in crate::domain::drawings::write::writer) fn write_smartart(
        &self,
        w: &mut XmlWriter,
        sa: &SmartArtWriteData,
        object_id: &mut u32,
    ) {
        let id = sa.original_id.unwrap_or(*object_id);
        *object_id += 1;

        w.start_element("xdr:graphicFrame").end_attrs();

        // Non-visual properties
        w.start_element("xdr:nvGraphicFramePr").end_attrs();
        {
            w.start_element("xdr:cNvPr")
                .attr_num("id", id)
                .attr("name", &sa.name)
                .self_close();
            w.start_element("xdr:cNvGraphicFramePr").self_close();
        }
        w.end_element("xdr:nvGraphicFramePr");

        // Transform (zeroed — position comes from the anchor)
        w.start_element("xdr:xfrm").end_attrs();
        {
            w.start_element("a:off")
                .attr_num("x", 0)
                .attr_num("y", 0)
                .self_close();
            w.start_element("a:ext")
                .attr_num("cx", 0)
                .attr_num("cy", 0)
                .self_close();
        }
        w.end_element("xdr:xfrm");

        // Graphic with diagram relIds
        w.start_element("a:graphic").end_attrs();
        {
            w.start_element("a:graphicData")
                .attr("uri", DIAGRAM_GRAPHIC_DATA_URI)
                .end_attrs();
            if !self.suppress_unregistered_relationships {
                w.start_element("dgm:relIds")
                    .attr("xmlns:dgm", NS_DGM)
                    .attr("r:dm", &sa.dm_rel_id)
                    .attr("r:lo", &sa.lo_rel_id)
                    .attr("r:qs", &sa.qs_rel_id)
                    .attr("r:cs", &sa.cs_rel_id)
                    .self_close();
            }
            w.end_element("a:graphicData");
        }
        w.end_element("a:graphic");

        w.end_element("xdr:graphicFrame");
    }

    // Write a slicer as `mc:AlternateContent` with `mc:Choice Requires="a14"`.
    //
    // Produces:
    // ```xml
    // <mc:AlternateContent>
    //   <mc:Choice Requires="a14">
    //     <xdr:graphicFrame>
    //       <xdr:nvGraphicFramePr>
    //         <xdr:cNvPr id="N" name="SlicerName"/>
    //         <xdr:cNvGraphicFramePr/>
    //       </xdr:nvGraphicFramePr>
    //       <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
    //       <a:graphic>
    //         <a:graphicData uri="http://schemas.microsoft.com/office/drawing/2010/slicer">
    //           <sle:slicer name="SlicerName"/>
    //         </a:graphicData>
    //       </a:graphic>
    //     </xdr:graphicFrame>
    //   </mc:Choice>
    //   <mc:Fallback/>
    // </mc:AlternateContent>
    // ```
}
