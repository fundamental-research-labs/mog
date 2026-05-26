/**
 * Matrix Layout Tests
 */

import { layoutEquation } from '../../src/layout/layout-engine';
import { parseOMML } from '../../src/parser/omml-parser';

function layoutFromOMML(omml: string, fontSize: number = 12) {
  const result = parseOMML(omml);
  if (!result.ok) throw new Error(`Parse failed: ${result.error.message}`);
  const nodes = result.value[0].type === 'oMath' ? (result.value[0] as any).children : result.value;
  return layoutEquation(nodes, fontSize);
}

describe('Matrix Layout', () => {
  it('produces non-zero dimensions for 2x2 matrix', () => {
    const omml =
      '<m:oMath><m:m><m:mr><m:e><m:r><m:t>a</m:t></m:r></m:e><m:e><m:r><m:t>b</m:t></m:r></m:e></m:mr><m:mr><m:e><m:r><m:t>c</m:t></m:r></m:e><m:e><m:r><m:t>d</m:t></m:r></m:e></m:mr></m:m></m:oMath>';
    const layout = layoutFromOMML(omml);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it('matrix is vertically centered (baseline at half height)', () => {
    const omml =
      '<m:oMath><m:m><m:mr><m:e><m:r><m:t>a</m:t></m:r></m:e></m:mr><m:mr><m:e><m:r><m:t>b</m:t></m:r></m:e></m:mr></m:m></m:oMath>';
    const layout = layoutFromOMML(omml);
    // Baseline should be approximately at the center
    expect(Math.abs(layout.baseline - layout.height / 2)).toBeLessThan(1);
  });

  it('matrix with more rows is taller', () => {
    const twoRow =
      '<m:oMath><m:m><m:mr><m:e><m:r><m:t>a</m:t></m:r></m:e></m:mr><m:mr><m:e><m:r><m:t>b</m:t></m:r></m:e></m:mr></m:m></m:oMath>';
    const threeRow =
      '<m:oMath><m:m><m:mr><m:e><m:r><m:t>a</m:t></m:r></m:e></m:mr><m:mr><m:e><m:r><m:t>b</m:t></m:r></m:e></m:mr><m:mr><m:e><m:r><m:t>c</m:t></m:r></m:e></m:mr></m:m></m:oMath>';

    const twoLayout = layoutFromOMML(twoRow);
    const threeLayout = layoutFromOMML(threeRow);
    expect(threeLayout.height).toBeGreaterThan(twoLayout.height);
  });

  it('snapshot: 2x2 matrix layout', () => {
    const omml =
      '<m:oMath><m:m><m:mr><m:e><m:r><m:t>a</m:t></m:r></m:e><m:e><m:r><m:t>b</m:t></m:r></m:e></m:mr><m:mr><m:e><m:r><m:t>c</m:t></m:r></m:e><m:e><m:r><m:t>d</m:t></m:r></m:e></m:mr></m:m></m:oMath>';
    const layout = layoutFromOMML(omml);
    expect({
      width: Math.round(layout.width),
      height: Math.round(layout.height),
      baseline: Math.round(layout.baseline),
      childCount: layout.children.length,
    }).toMatchSnapshot();
  });
});
