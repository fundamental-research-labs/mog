#!/usr/bin/env bash
# ---------------------------------------------------------
# docs/brand/logo/generate.sh — Single-source logo build pipeline
#
# Source of truth:  docs/brand/logo/mog-app-icon.svg
# Generates:
#   docs/brand/logo/generated/icon-{16,32,64,128,256,512,1024}.png
#   docs/brand/logo/generated/favicon.svg           (cleaned SVG for web)
#   docs/brand/logo/generated/favicon-data-uri.txt  (URL-encoded data URI)
#   docs/brand/logo/generated/MogLogo.tsx           (React component)
#   runtime/src-tauri/icons/*            (all Tauri icons)
# ---------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"

SOURCE="mog-app-icon.svg"
GENERATED="generated"
TAURI_ICONS="../../../runtime/src-tauri/icons"

if [ ! -f "$SOURCE" ]; then
  echo "ERROR: $SOURCE not found. Place your logo SVG here first."
  exit 1
fi

# Check required tools
for tool in rsvg-convert iconutil node; do
  if ! command -v "$tool" &>/dev/null; then
    echo "ERROR: $tool is required but not found."
    exit 1
  fi
done

mkdir -p "$GENERATED"
mkdir -p "$TAURI_ICONS"

echo "==> Generating PNGs from $SOURCE..."

SIZES=(16 32 64 128 256 512 1024)
for size in "${SIZES[@]}"; do
  rsvg-convert -w "$size" -h "$size" "$SOURCE" -o "$GENERATED/icon-${size}.png"
  echo "    icon-${size}.png"
done

# Tauri-specific sizes
echo "==> Copying to Tauri icons..."
cp "$GENERATED/icon-32.png"   "$TAURI_ICONS/32x32.png"
cp "$GENERATED/icon-128.png"  "$TAURI_ICONS/128x128.png"
cp "$GENERATED/icon-256.png"  "$TAURI_ICONS/128x128@2x.png"
cp "$GENERATED/icon-512.png"  "$TAURI_ICONS/icon.png"

# Generate .icns (macOS)
echo "==> Generating icon.icns..."
ICONSET_DIR=$(mktemp -d)/mog.iconset
mkdir -p "$ICONSET_DIR"
cp "$GENERATED/icon-16.png"   "$ICONSET_DIR/icon_16x16.png"
cp "$GENERATED/icon-32.png"   "$ICONSET_DIR/icon_16x16@2x.png"
cp "$GENERATED/icon-32.png"   "$ICONSET_DIR/icon_32x32.png"
cp "$GENERATED/icon-64.png"   "$ICONSET_DIR/icon_32x32@2x.png"
cp "$GENERATED/icon-128.png"  "$ICONSET_DIR/icon_128x128.png"
cp "$GENERATED/icon-256.png"  "$ICONSET_DIR/icon_128x128@2x.png"
cp "$GENERATED/icon-256.png"  "$ICONSET_DIR/icon_256x256.png"
cp "$GENERATED/icon-512.png"  "$ICONSET_DIR/icon_256x256@2x.png"
cp "$GENERATED/icon-512.png"  "$ICONSET_DIR/icon_512x512.png"
cp "$GENERATED/icon-1024.png" "$ICONSET_DIR/icon_512x512@2x.png"
iconutil -c icns "$ICONSET_DIR" -o "$TAURI_ICONS/icon.icns"
rm -rf "$(dirname "$ICONSET_DIR")"

# Generate .ico (Windows) — uses inline Node.js ICO builder
echo "==> Generating icon.ico..."
node -e "
const fs = require('fs');

// ICO format: header + directory entries + PNG data
// We embed 16, 32, 48, 64, 128, 256 px PNGs
const sizes = [16, 32, 64, 128, 256];
const pngs = sizes.map(s => fs.readFileSync('$GENERATED/icon-' + s + '.png'));

const numImages = pngs.length;
// ICO header: 6 bytes
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);           // reserved
header.writeUInt16LE(1, 2);           // type: 1 = ICO
header.writeUInt16LE(numImages, 4);   // number of images

// Directory entries: 16 bytes each
const dirSize = numImages * 16;
let dataOffset = 6 + dirSize;
const dirs = [];
const datas = [];

for (let i = 0; i < numImages; i++) {
  const png = pngs[i];
  const s = sizes[i];
  const dir = Buffer.alloc(16);
  dir.writeUInt8(s >= 256 ? 0 : s, 0);    // width (0 = 256+)
  dir.writeUInt8(s >= 256 ? 0 : s, 1);    // height
  dir.writeUInt8(0, 2);                    // color palette
  dir.writeUInt8(0, 3);                    // reserved
  dir.writeUInt16LE(1, 4);                 // color planes
  dir.writeUInt16LE(32, 6);               // bits per pixel
  dir.writeUInt32LE(png.length, 8);       // data size
  dir.writeUInt32LE(dataOffset, 12);      // data offset
  dirs.push(dir);
  datas.push(png);
  dataOffset += png.length;
}

const ico = Buffer.concat([header, ...dirs, ...datas]);
fs.writeFileSync('$TAURI_ICONS/icon.ico', ico);
"

# Generate favicon SVG (just copy the source)
echo "==> Generating favicon.svg..."
cp "$SOURCE" "$GENERATED/favicon.svg"

# Generate URL-encoded data URI for HTML
echo "==> Generating favicon data URI..."
node -e "
const fs = require('fs');
const svg = fs.readFileSync('$SOURCE', 'utf8');
const encoded = 'data:image/svg+xml,' + encodeURIComponent(svg);
fs.writeFileSync('$GENERATED/favicon-data-uri.txt', encoded);
"

# Generate React component from SVG
echo "==> Generating MogLogo.tsx React component..."
node -e "
const fs = require('fs');
const svg = fs.readFileSync('$SOURCE', 'utf8');

// Extract the inner content (everything between <svg> tags)
const innerMatch = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
const inner = innerMatch ? innerMatch[1].trim() : '';

// Extract viewBox
const vbMatch = svg.match(/viewBox=\"([^\"]*)\"/);
const viewBox = vbMatch ? vbMatch[1] : '0 0 512 512';

const component = \`/**
 * Auto-generated from docs/brand/logo/mog-app-icon.svg by docs/brand/logo/generate.sh
 * DO NOT EDIT — edit the source SVG and re-run the generator.
 */

export function MogLogo({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns=\"http://www.w3.org/2000/svg\"
      viewBox=\"\${viewBox}\"
      width={size}
      height={size}
      className={className}
    >
\${inner.split('\\n').map(l => '      ' + l).join('\\n')}
    </svg>
  );
}
\`;

fs.writeFileSync('$GENERATED/MogLogo.tsx', component);
"

echo ""
echo "==> Done! All assets generated from $SOURCE."
echo ""
echo "Generated files:"
ls -la "$GENERATED/"
echo ""
echo "Tauri icons:"
ls -la "$TAURI_ICONS/"
