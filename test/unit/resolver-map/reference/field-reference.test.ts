import { expect } from 'chai';
import { unique, difference, fieldExistsInResolverMap } from '../../../../src/resolver-map/reference/field-reference';

describe('resolver-map/reference/field-reference', () => {
  describe('#unique', () => {
    expect(
      unique([
        ['Query', 'field'],
        ['Query', 'otherField'],
        ['Query', 'field'],
      ]),
    ).to.deep.equal([
      ['Query', 'field'],
      ['Query', 'otherField'],
    ]);
  });

  describe('#difference', () => {
    it('removes the second set from the first set', () => {
      expect(
        difference(
          [
            ['Query', 'field'],
            ['Query', 'otherField'],
          ],
          [['Query', 'otherField']],
        ),
      ).to.deep.equal([['Query', 'field']]);
    });
  });

  describe('#isfieldReferenceInResolverMap', () => {
    const resolverMap = {
      Query: {
        field: (): string => 'noop',
      },
    };

    it('returns true when a field exists in a resolver map', () => {
      expect(fieldExistsInResolverMap(['Query', 'field'], resolverMap)).to.be.true;
    });

    it('returns false when a field does not exist in a resolver map', () => {
      expect(fieldExistsInResolverMap(['Query', 'nonInMap'], resolverMap)).to.be.false;
    });
  });
});