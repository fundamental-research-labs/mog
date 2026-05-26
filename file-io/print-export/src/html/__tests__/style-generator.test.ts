import { StyleGenerator } from '../style-generator';

describe('StyleGenerator', () => {
  it('serializes center-across alignment as valid CSS', () => {
    const styles = new StyleGenerator().formatToStyles({
      horizontalAlign: 'centerContinuous',
    });

    expect(styles['text-align']).toBe('center');
    expect(Object.values(styles)).not.toContain('centerContinuous');
  });
});
