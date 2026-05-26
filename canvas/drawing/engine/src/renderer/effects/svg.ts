/**
 * SVG Effect Rendering
 *
 * Generates SVG <filter> elements for ECMA-376 drawing effects.
 * Each function returns a fragment of SVG filter primitives.
 * The composite function wraps them in a <filter> element.
 *
 * @see ECMA-376 Part 1, Section 20.1.8 (DrawingML - Effects)
 */
import type { DrawingEffects } from '@mog-sdk/contracts/drawing';
import type {
  Bevel,
  ColorRef,
  PresetMaterialType,
  Scene3D,
  Shape3D,
} from '@mog-sdk/contracts/drawing/three-d';
import type {
  BevelEffect,
  GlowEffect,
  InnerShadowEffect,
  OuterShadowEffect,
} from '@mog-sdk/contracts/text-effects';
import { EMU_PER_PIXEL, emuToPx } from './utils';

/** Generate SVG filter primitives for an outer shadow. */
export function outerShadowToSVGFilter(shadow: OuterShadowEffect, resultId: string): string {
  const blurPx = emuToPx(shadow.blurRadius);
  const distPx = emuToPx(shadow.distance);
  const dirRad = (shadow.direction * Math.PI) / 180;
  const dx = Math.cos(dirRad) * distPx;
  const dy = Math.sin(dirRad) * distPx;
  return `<feDropShadow dx="${dx}" dy="${dy}" stdDeviation="${blurPx}" flood-color="${shadow.color}" flood-opacity="${shadow.opacity}" result="${resultId}"/>`;
}

/** Generate SVG filter primitives for an inner shadow. */
export function innerShadowToSVGFilter(shadow: InnerShadowEffect, resultId: string): string {
  const blurPx = emuToPx(shadow.blurRadius);
  const distPx = emuToPx(shadow.distance);
  const dirRad = (shadow.direction * Math.PI) / 180;
  const dx = Math.cos(dirRad) * distPx;
  const dy = Math.sin(dirRad) * distPx;
  // Inner shadow: offset + blur the source, then composite inside the original shape
  return (
    `<feOffset dx="${dx}" dy="${dy}" in="SourceAlpha" result="${resultId}_off"/>` +
    `<feGaussianBlur stdDeviation="${blurPx}" in="${resultId}_off" result="${resultId}_blur"/>` +
    `<feFlood flood-color="${shadow.color}" flood-opacity="${shadow.opacity}" result="${resultId}_color"/>` +
    `<feComposite in="${resultId}_color" in2="${resultId}_blur" operator="in" result="${resultId}"/>`
  );
}

/** Generate SVG filter primitives for a glow effect. */
export function glowToSVGFilter(glow: GlowEffect, resultId: string): string {
  const radiusPx = emuToPx(glow.radius);
  return (
    `<feGaussianBlur stdDeviation="${radiusPx}" in="SourceAlpha" result="${resultId}_blur"/>` +
    `<feFlood flood-color="${glow.color}" flood-opacity="${glow.opacity}" result="${resultId}_color"/>` +
    `<feComposite in="${resultId}_color" in2="${resultId}_blur" operator="in" result="${resultId}"/>`
  );
}

/** Generate SVG filter primitives for a bevel effect (simplified). */
export function bevelToSVGFilter(bevel: BevelEffect, resultId: string): string {
  // Derive specular lighting properties from bevel parameters
  const widthPx = emuToPx(bevel.topWidth || 25400); // default 2pt
  const heightPx = emuToPx(bevel.topHeight || 25400);
  const surfaceScale = Math.max(1, Math.round(widthPx + heightPx) / 2);
  // Map preset to specular constant/exponent for different edge profiles
  let specularConstant = 0.6;
  let specularExponent = 20;
  if (bevel.topPreset) {
    switch (bevel.topPreset) {
      case 'circle':
        specularConstant = 0.6;
        specularExponent = 20;
        break;
      case 'relaxedInset':
        specularConstant = 0.4;
        specularExponent = 15;
        break;
      case 'slope':
        specularConstant = 0.8;
        specularExponent = 30;
        break;
      case 'hardEdge':
        specularConstant = 1.0;
        specularExponent = 40;
        break;
      case 'softRound':
        specularConstant = 0.5;
        specularExponent = 12;
        break;
      case 'convex':
        specularConstant = 0.7;
        specularExponent = 25;
        break;
      case 'cross':
        specularConstant = 0.7;
        specularExponent = 20;
        break;
      case 'angle':
        specularConstant = 0.8;
        specularExponent = 25;
        break;
      case 'coolSlant':
        specularConstant = 0.5;
        specularExponent = 15;
        break;
      case 'divot':
        specularConstant = 0.4;
        specularExponent = 10;
        break;
      case 'riblet':
        specularConstant = 0.6;
        specularExponent = 30;
        break;
      case 'artDeco':
        specularConstant = 0.9;
        specularExponent = 35;
        break;
      default:
        specularConstant = 0.6;
        specularExponent = 20;
        break;
    }
  }
  return (
    `<feSpecularLighting surfaceScale="${surfaceScale}" specularConstant="${specularConstant}" specularExponent="${specularExponent}" ` +
    `in="SourceAlpha" result="${resultId}">` +
    `<fePointLight x="-5000" y="-10000" z="20000"/>` +
    `</feSpecularLighting>`
  );
}

/**
 * Generate SVG filter primitives for a 3D bevel using the shared Bevel type.
 *
 * Accepts the canonical `Bevel` type from `drawing/three-d` (with `prst`, `w`, `h`).
 * This complements the existing `bevelToSVGFilter` which accepts the TextEffect
 * `BevelEffect` type (with `topPreset`, `topWidth`, `topHeight`).
 */
export function bevel3DToSVGFilter(bevel: Bevel, resultId: string): string {
  const widthPx = emuToPx(bevel.w || 25400);
  const heightPx = emuToPx(bevel.h || 25400);
  const surfaceScale = Math.max(1, Math.round(widthPx + heightPx) / 2);

  let specularConstant = 0.6;
  let specularExponent = 20;
  if (bevel.prst) {
    switch (bevel.prst) {
      case 'circle':
        specularConstant = 0.6;
        specularExponent = 20;
        break;
      case 'relaxedInset':
        specularConstant = 0.4;
        specularExponent = 15;
        break;
      case 'slope':
        specularConstant = 0.8;
        specularExponent = 30;
        break;
      case 'hardEdge':
        specularConstant = 1.0;
        specularExponent = 40;
        break;
      case 'softRound':
        specularConstant = 0.5;
        specularExponent = 12;
        break;
      case 'convex':
        specularConstant = 0.7;
        specularExponent = 25;
        break;
      case 'cross':
        specularConstant = 0.7;
        specularExponent = 20;
        break;
      case 'angle':
        specularConstant = 0.8;
        specularExponent = 25;
        break;
      case 'coolSlant':
        specularConstant = 0.5;
        specularExponent = 15;
        break;
      case 'divot':
        specularConstant = 0.4;
        specularExponent = 10;
        break;
      case 'riblet':
        specularConstant = 0.6;
        specularExponent = 30;
        break;
      case 'artDeco':
        specularConstant = 0.9;
        specularExponent = 35;
        break;
      default:
        specularConstant = 0.6;
        specularExponent = 20;
        break;
    }
  }
  return (
    `<feSpecularLighting surfaceScale="${surfaceScale}" specularConstant="${specularConstant}" specularExponent="${specularExponent}" ` +
    `in="SourceAlpha" result="${resultId}">` +
    `<fePointLight x="-5000" y="-10000" z="20000"/>` +
    `</feSpecularLighting>`
  );
}

/**
 * Generate SVG filter primitives approximating 3D extrusion as layered offset shadows.
 *
 * Creates multiple `<feOffset>` + `<feFlood>` layers stacked at decreasing offsets
 * to simulate depth from extrusion. Limited to max 5 layers for performance.
 */
export function extrusionToSVGFilter(
  extrusionH: number,
  extrusionClr?: ColorRef,
  filterId?: string,
): { filterDefs: string; filterRef: string } | null {
  if (extrusionH <= 0) return null;

  const depthPx = extrusionH / EMU_PER_PIXEL;
  if (depthPx < 0.5) return null;

  const id = filterId || 'extrusion_fx';
  // Resolve color: use srgbClr val, or default to dark gray
  const color = extrusionClr?.val
    ? extrusionClr.val.startsWith('#')
      ? extrusionClr.val
      : `#${extrusionClr.val}`
    : '#555555';

  const layerCount = Math.min(5, Math.max(1, Math.ceil(depthPx)));
  const parts: string[] = [];
  const mergeNodeIds: string[] = [];

  for (let i = 0; i < layerCount; i++) {
    const fraction = (i + 1) / layerCount;
    const offsetPx = depthPx * fraction;
    const opacity = (1 - fraction * 0.6).toFixed(2);
    const layerId = `${id}_l${i}`;

    parts.push(
      `<feFlood flood-color="${color}" flood-opacity="${opacity}" result="${layerId}_clr"/>` +
        `<feComposite in="${layerId}_clr" in2="SourceAlpha" operator="in" result="${layerId}_mask"/>` +
        `<feOffset dx="${offsetPx.toFixed(1)}" dy="${offsetPx.toFixed(1)}" in="${layerId}_mask" result="${layerId}"/>`,
    );
    mergeNodeIds.push(layerId);
  }

  // Merge extrusion layers behind the source graphic
  const mergeNodes = mergeNodeIds.map((mid) => `<feMergeNode in="${mid}"/>`).join('');
  const feMerge = `<feMerge>${mergeNodes}<feMergeNode in="SourceGraphic"/></feMerge>`;

  const filterDefs = `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">${parts.join('')}${feMerge}</filter>`;
  return { filterDefs, filterRef: `url(#${id})` };
}

/**
 * Generate SVG filter primitives for a material type.
 *
 * Maps ECMA-376 preset materials to SVG lighting parameters.
 * Returns null for materials with no visible lighting effect (e.g., `flat`).
 */
export function materialToSVGFilter(
  material: PresetMaterialType,
  filterId?: string,
): { filterDefs: string; filterRef: string } | null {
  const id = filterId || 'material_fx';

  let primitives: string;
  switch (material) {
    case 'flat':
      return null;
    case 'matte':
    case 'legacyMatte':
    case 'warmMatte':
    case 'powder':
    case 'translucentPowder':
      // Diffuse-only lighting (matte family)
      primitives =
        `<feDiffuseLighting surfaceScale="1" diffuseConstant="1" in="SourceAlpha" result="${id}_lit">` +
        `<fePointLight x="-5000" y="-10000" z="20000"/>` +
        `</feDiffuseLighting>` +
        `<feComposite in="${id}_lit" in2="SourceGraphic" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="${id}"/>`;
      break;
    case 'plastic':
    case 'legacyPlastic':
    case 'softEdge':
      // Moderate specular (plastic family)
      primitives =
        `<feSpecularLighting surfaceScale="2" specularConstant="0.5" specularExponent="15" in="SourceAlpha" result="${id}_spec">` +
        `<fePointLight x="-5000" y="-10000" z="20000"/>` +
        `</feSpecularLighting>` +
        `<feComposite in="${id}_spec" in2="SourceGraphic" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="${id}"/>`;
      break;
    case 'metal':
    case 'legacyMetal':
    case 'softmetal':
    case 'dkEdge':
      // High specular (metal family)
      primitives =
        `<feSpecularLighting surfaceScale="3" specularConstant="1.0" specularExponent="40" in="SourceAlpha" result="${id}_spec">` +
        `<fePointLight x="-5000" y="-10000" z="20000"/>` +
        `</feSpecularLighting>` +
        `<feComposite in="${id}_spec" in2="SourceGraphic" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="${id}"/>`;
      break;
    case 'legacyWireframe':
      // Wireframe: no fill lighting, return null
      return null;
    default:
      // Unknown materials: use plastic as a safe default
      primitives =
        `<feSpecularLighting surfaceScale="2" specularConstant="0.5" specularExponent="15" in="SourceAlpha" result="${id}_spec">` +
        `<fePointLight x="-5000" y="-10000" z="20000"/>` +
        `</feSpecularLighting>` +
        `<feComposite in="${id}_spec" in2="SourceGraphic" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="${id}"/>`;
      break;
  }

  const filterDefs = `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">${primitives}</filter>`;
  return { filterDefs, filterRef: `url(#${id})` };
}

/**
 * Compose 3D effects (bevel, extrusion, material) into a single SVG <filter>.
 *
 * Merges individual 3D effect filter primitives into one composite filter.
 * Returns null if no 3D effects produce filter primitives.
 */
export function compose3DEffectsToSVGFilter(
  _scene3d?: Scene3D,
  sp3d?: Shape3D,
  filterId?: string,
): { filterDefs: string; filterRef: string } | null {
  if (!sp3d) return null;

  const id = filterId || '3d_fx';
  const parts: string[] = [];
  const resultIds: string[] = [];
  let stepIdx = 0;

  // Top bevel
  if (sp3d.bevelT) {
    const rid = `${id}_bvT_${stepIdx++}`;
    parts.push(bevel3DToSVGFilter(sp3d.bevelT, rid));
    resultIds.push(rid);
  }

  // Bottom bevel
  if (sp3d.bevelB) {
    const rid = `${id}_bvB_${stepIdx++}`;
    parts.push(bevel3DToSVGFilter(sp3d.bevelB, rid));
    resultIds.push(rid);
  }

  // Extrusion (inline the primitives rather than nesting filters)
  if (sp3d.extrusionH && sp3d.extrusionH > 0) {
    const depthPx = sp3d.extrusionH / EMU_PER_PIXEL;
    if (depthPx >= 0.5) {
      const color = sp3d.extrusionClr?.val
        ? sp3d.extrusionClr.val.startsWith('#')
          ? sp3d.extrusionClr.val
          : `#${sp3d.extrusionClr.val}`
        : '#555555';
      const layerCount = Math.min(5, Math.max(1, Math.ceil(depthPx)));
      for (let i = 0; i < layerCount; i++) {
        const fraction = (i + 1) / layerCount;
        const offsetPx = depthPx * fraction;
        const opacity = (1 - fraction * 0.6).toFixed(2);
        const layerId = `${id}_ext_${stepIdx++}`;

        parts.push(
          `<feFlood flood-color="${color}" flood-opacity="${opacity}" result="${layerId}_clr"/>` +
            `<feComposite in="${layerId}_clr" in2="SourceAlpha" operator="in" result="${layerId}_mask"/>` +
            `<feOffset dx="${offsetPx.toFixed(1)}" dy="${offsetPx.toFixed(1)}" in="${layerId}_mask" result="${layerId}"/>`,
        );
        resultIds.push(layerId);
      }
    }
  }

  // Material lighting
  if (sp3d.prstMaterial && sp3d.prstMaterial !== 'flat') {
    const matId = `${id}_mat_${stepIdx++}`;
    // Inline the material lighting primitives
    let matPrimitives = '';
    switch (sp3d.prstMaterial) {
      case 'matte':
      case 'legacyMatte':
      case 'warmMatte':
      case 'powder':
      case 'translucentPowder':
        matPrimitives =
          `<feDiffuseLighting surfaceScale="1" diffuseConstant="1" in="SourceAlpha" result="${matId}_lit">` +
          `<fePointLight x="-5000" y="-10000" z="20000"/>` +
          `</feDiffuseLighting>` +
          `<feComposite in="${matId}_lit" in2="SourceGraphic" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="${matId}"/>`;
        break;
      case 'metal':
      case 'legacyMetal':
      case 'softmetal':
      case 'dkEdge':
        matPrimitives =
          `<feSpecularLighting surfaceScale="3" specularConstant="1.0" specularExponent="40" in="SourceAlpha" result="${matId}_spec">` +
          `<fePointLight x="-5000" y="-10000" z="20000"/>` +
          `</feSpecularLighting>` +
          `<feComposite in="${matId}_spec" in2="SourceGraphic" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="${matId}"/>`;
        break;
      case 'legacyWireframe':
        break;
      default:
        // plastic family / unknown → moderate specular
        matPrimitives =
          `<feSpecularLighting surfaceScale="2" specularConstant="0.5" specularExponent="15" in="SourceAlpha" result="${matId}_spec">` +
          `<fePointLight x="-5000" y="-10000" z="20000"/>` +
          `</feSpecularLighting>` +
          `<feComposite in="${matId}_spec" in2="SourceGraphic" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="${matId}"/>`;
        break;
    }
    if (matPrimitives) {
      parts.push(matPrimitives);
      resultIds.push(matId);
    }
  }

  if (parts.length === 0) return null;

  const mergeNodes = resultIds.map((rid) => `<feMergeNode in="${rid}"/>`).join('');
  const feMerge = `<feMerge>${mergeNodes}<feMergeNode in="SourceGraphic"/></feMerge>`;

  const filterDefs = `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">${parts.join('')}${feMerge}</filter>`;
  return { filterDefs, filterRef: `url(#${id})` };
}

/**
 * Composite all effects from a DrawingEffects into a single SVG <filter> element.
 *
 * Returns the full `<filter>...</filter>` string, or empty string if no
 * effects produce filter primitives.
 *
 * Optionally accepts 3D effect parameters (scene3d, sp3d) which are merged
 * into the composite filter alongside traditional 2D effects.
 */
export function compositeEffectsToSVGFilter(
  effects: DrawingEffects,
  filterId: string,
  three_d?: { scene3d?: Scene3D; sp3d?: Shape3D },
): string {
  const parts: string[] = [];
  const resultIds: string[] = [];
  let stepIdx = 0;

  if (effects.outerShadow) {
    for (const shadow of effects.outerShadow) {
      const id = `os_${stepIdx++}`;
      parts.push(outerShadowToSVGFilter(shadow, id));
      resultIds.push(id);
    }
  }
  if (effects.innerShadow) {
    for (const shadow of effects.innerShadow) {
      const id = `is_${stepIdx++}`;
      parts.push(innerShadowToSVGFilter(shadow, id));
      resultIds.push(id);
    }
  }
  if (effects.glow) {
    const id = `glow_${stepIdx++}`;
    parts.push(glowToSVGFilter(effects.glow, id));
    resultIds.push(id);
  }
  if (effects.bevel) {
    const id = `bevel_${stepIdx++}`;
    parts.push(bevelToSVGFilter(effects.bevel, id));
    resultIds.push(id);
  }

  // Integrate 3D effects if provided
  if (three_d) {
    const three_dResult = compose3DEffectsToSVGFilter(
      three_d.scene3d,
      three_d.sp3d,
      `${filterId}_3d`,
    );
    if (three_dResult) {
      // Extract the filter primitives from the 3D composite (strip outer <filter> wrapper)
      const innerMatch = three_dResult.filterDefs.match(/<filter[^>]*>([\s\S]*)<\/filter>/);
      if (innerMatch?.[1]) {
        parts.push(innerMatch[1].replace(/<feMerge>[\s\S]*<\/feMerge>/, ''));
        // Collect result IDs from the 3D merge nodes
        const mergeNodeRegex = /<feMergeNode in="([^"]+)"\/>/g;
        const mergeContent = three_dResult.filterDefs.match(/<feMerge>([\s\S]*?)<\/feMerge>/);
        if (mergeContent?.[1]) {
          let match;
          while ((match = mergeNodeRegex.exec(mergeContent[1])) !== null) {
            if (match[1] !== 'SourceGraphic') {
              resultIds.push(match[1]);
            }
          }
        }
      }
    }
  }

  if (parts.length === 0) return '';

  // Combine all effect results with the original graphic using feMerge
  const mergeNodes = resultIds.map((id) => `<feMergeNode in="${id}"/>`).join('');
  const feMerge = `<feMerge>${mergeNodes}<feMergeNode in="SourceGraphic"/></feMerge>`;

  return `<filter id="${filterId}" x="-50%" y="-50%" width="200%" height="200%">${parts.join('')}${feMerge}</filter>`;
}
