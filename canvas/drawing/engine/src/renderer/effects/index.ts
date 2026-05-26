/**
 * Effects barrel - re-exports canvas and SVG effect primitives.
 */
export {
  colorWithOpacity,
  render3DBevelToCanvas,
  renderBevelToCanvas,
  renderExtrusionToCanvas,
  renderGlowToCanvas,
  renderInnerShadowToCanvas,
  renderMaterialToCanvas,
  renderOuterShadowToCanvas,
  renderSoftEdgeToCanvas,
} from './canvas';

export {
  bevel3DToSVGFilter,
  bevelToSVGFilter,
  compose3DEffectsToSVGFilter,
  compositeEffectsToSVGFilter,
  extrusionToSVGFilter,
  glowToSVGFilter,
  innerShadowToSVGFilter,
  materialToSVGFilter,
  outerShadowToSVGFilter,
} from './svg';

export { EMU_PER_PIXEL, emuToPx } from './utils';
