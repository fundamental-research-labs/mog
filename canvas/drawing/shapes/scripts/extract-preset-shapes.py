#!/usr/bin/env python3
"""
Extract preset shape geometry data from the OOXML spec XML into a JSON file.

Reads: ooxml/spec/ecma-376/part1/OfficeOpenXML-DrawingMLGeometries.zip
       (or /tmp/ooxml-spec/presetShapeDefinitions.xml if already extracted)
Writes: canvas/drawing/shapes/src/presets/preset-shape-data.json

Usage:
    python3 canvas/drawing/shapes/scripts/extract-preset-shapes.py
"""

import json
import os
import sys
import xml.etree.ElementTree as ET
import zipfile

NS = "http://schemas.openxmlformats.org/drawingml/2006/main"

# Resolve paths relative to the repo root
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", "..", "..", ".."))
ZIP_PATH = os.path.join(
    REPO_ROOT, "os", "ooxml", "spec", "ecma-376", "part1",
    "OfficeOpenXML-DrawingMLGeometries.zip"
)
EXTRACTED_PATH = "/tmp/ooxml-spec/presetShapeDefinitions.xml"
OUTPUT_PATH = os.path.join(
    SCRIPT_DIR, "..", "src", "presets", "preset-shape-data.json"
)


def get_xml_root():
    """Get the XML root, extracting from zip if needed."""
    # Try extracted file first
    if os.path.isfile(EXTRACTED_PATH):
        print(f"Reading from {EXTRACTED_PATH}")
        tree = ET.parse(EXTRACTED_PATH)
        return tree.getroot()

    # Extract from zip
    if not os.path.isfile(ZIP_PATH):
        print(f"ERROR: Cannot find zip at {ZIP_PATH}", file=sys.stderr)
        print(f"       or extracted XML at {EXTRACTED_PATH}", file=sys.stderr)
        sys.exit(1)

    print(f"Extracting from {ZIP_PATH}")
    with zipfile.ZipFile(ZIP_PATH, "r") as zf:
        # Find the XML file inside the zip
        xml_names = [n for n in zf.namelist() if n.endswith(".xml")]
        if not xml_names:
            print("ERROR: No XML file found in zip", file=sys.stderr)
            sys.exit(1)
        xml_name = xml_names[0]
        print(f"  Found: {xml_name}")
        xml_bytes = zf.read(xml_name)
        # Remove BOM if present
        if xml_bytes.startswith(b"\xef\xbb\xbf"):
            xml_bytes = xml_bytes[3:]
        root = ET.fromstring(xml_bytes)
        return root


def parse_gd_list(parent, tag):
    """Parse a list of guide definitions (avLst or gdLst)."""
    result = []
    elem = parent.find(f"{{{NS}}}{tag}")
    if elem is None:
        return result
    for gd in elem.findall(f"{{{NS}}}gd"):
        name = gd.get("name", "")
        fmla = gd.get("fmla", "")
        result.append({"name": name, "fmla": fmla})
    return result


def parse_path_commands(path_elem):
    """Parse path commands from a <path> element."""
    commands = []
    for child in path_elem:
        tag = child.tag.replace(f"{{{NS}}}", "")

        if tag == "moveTo":
            pt = child.find(f"{{{NS}}}pt")
            if pt is not None:
                commands.append({
                    "type": "moveTo",
                    "x": pt.get("x", "0"),
                    "y": pt.get("y", "0"),
                })

        elif tag == "lnTo":
            pt = child.find(f"{{{NS}}}pt")
            if pt is not None:
                commands.append({
                    "type": "lineTo",
                    "x": pt.get("x", "0"),
                    "y": pt.get("y", "0"),
                })

        elif tag == "cubicBezTo":
            pts = child.findall(f"{{{NS}}}pt")
            if len(pts) == 3:
                commands.append({
                    "type": "cubicBezTo",
                    "x1": pts[0].get("x", "0"),
                    "y1": pts[0].get("y", "0"),
                    "x2": pts[1].get("x", "0"),
                    "y2": pts[1].get("y", "0"),
                    "x3": pts[2].get("x", "0"),
                    "y3": pts[2].get("y", "0"),
                })

        elif tag == "quadBezTo":
            pts = child.findall(f"{{{NS}}}pt")
            if len(pts) == 2:
                commands.append({
                    "type": "quadBezTo",
                    "x1": pts[0].get("x", "0"),
                    "y1": pts[0].get("y", "0"),
                    "x2": pts[1].get("x", "0"),
                    "y2": pts[1].get("y", "0"),
                })

        elif tag == "arcTo":
            commands.append({
                "type": "arcTo",
                "wR": child.get("wR", "0"),
                "hR": child.get("hR", "0"),
                "stAng": child.get("stAng", "0"),
                "swAng": child.get("swAng", "0"),
            })

        elif tag == "close":
            commands.append({"type": "close"})

    return commands


def parse_path_list(parent):
    """Parse the pathLst element."""
    result = []
    path_lst = parent.find(f"{{{NS}}}pathLst")
    if path_lst is None:
        return result

    for path in path_lst.findall(f"{{{NS}}}path"):
        path_data = {}

        # Optional width/height for path coordinate space
        w = path.get("w")
        h = path.get("h")
        if w is not None:
            path_data["w"] = int(w)
        if h is not None:
            path_data["h"] = int(h)

        # Fill attribute
        fill = path.get("fill")
        if fill == "none":
            path_data["fill"] = "none"

        # Stroke attribute
        stroke = path.get("stroke")
        if stroke in ("0", "false"):
            path_data["stroke"] = False

        # Parse commands
        path_data["commands"] = parse_path_commands(path)
        result.append(path_data)

    return result


def parse_shape(shape_elem):
    """Parse a single shape element."""
    return {
        "avLst": parse_gd_list(shape_elem, "avLst"),
        "gdLst": parse_gd_list(shape_elem, "gdLst"),
        "pathLst": parse_path_list(shape_elem),
    }


def main():
    root = get_xml_root()

    shapes = {}
    duplicates = []

    for child in root:
        name = child.tag
        if name in shapes:
            duplicates.append(name)
            # Keep the last occurrence (overwrite)
        shapes[name] = parse_shape(child)

    if duplicates:
        print(f"Warning: {len(duplicates)} duplicate shape name(s): {duplicates}")

    # Ensure output directory exists
    output_path = os.path.normpath(OUTPUT_PATH)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(shapes, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"Wrote {len(shapes)} shapes to {output_path}")

    # Quick stats
    total_paths = sum(len(s["pathLst"]) for s in shapes.values())
    total_commands = sum(
        len(p["commands"])
        for s in shapes.values()
        for p in s["pathLst"]
    )
    shapes_with_guides = sum(1 for s in shapes.values() if s["gdLst"])
    shapes_with_adjustments = sum(1 for s in shapes.values() if s["avLst"])

    print(f"  Total paths: {total_paths}")
    print(f"  Total commands: {total_commands}")
    print(f"  Shapes with guides: {shapes_with_guides}")
    print(f"  Shapes with adjustments: {shapes_with_adjustments}")


if __name__ == "__main__":
    main()
