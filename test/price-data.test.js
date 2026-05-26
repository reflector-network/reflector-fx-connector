/*eslint-disable no-undef */
const PriceData = require('../src/models/price-data')
const {priceToBigInt} = PriceData

const PRICE_SCALE = 10n ** 14n

describe('PriceData', () => {
    it('stores volume and quoteVolume, not price/type', () => {
        const pd = new PriceData({price: '1.23', source: 'test', ts: 0})
        expect(pd.volume).toBe(123_00000000000000n / 100n) //1.23 * 10^14
        expect(pd.quoteVolume).toBe(PRICE_SCALE)
        expect(pd.source).toBe('test')
        expect(pd.price).toBeUndefined()
        expect(pd.type).toBeUndefined()
    })

    it('accepts a BigInt price input directly', () => {
        const p = 5n * PRICE_SCALE //5.0 as 14-dec BigInt
        const pd = new PriceData({price: p, source: 'test', ts: 0})
        expect(pd.volume).toBe(p)
        expect(pd.quoteVolume).toBe(PRICE_SCALE)
    })

    it('VWAP-recovers the original price for decimals=14', () => {
        const price = 1_50000000000000n //1.5 * 10^14
        const pd = new PriceData({price, source: 'test', ts: 0})
        //mirror reflector-node getVWAP at decimals=14
        const recovered = pd.volume * (10n ** 14n) / pd.quoteVolume
        expect(recovered).toBe(price)
    })

    it('toJSON returns the plain object (not a string)', () => {
        const pd = new PriceData({price: '2.5', source: 'test', ts: 0})
        const json = pd.toJSON()
        expect(typeof json).toBe('object')
        expect(json).toEqual({volume: pd.volume, quoteVolume: pd.quoteVolume, source: 'test'})
    })

    it('toPlainObject excludes ts and exposes only the wire fields', () => {
        const pd = new PriceData({price: '2.5', source: 'test', ts: 12345})
        const plain = pd.toPlainObject()
        expect(plain).toEqual({volume: pd.volume, quoteVolume: pd.quoteVolume, source: 'test'})
        expect(plain.ts).toBeUndefined()
        expect(plain.type).toBeUndefined()
    })

    it('zero/empty price emits {volume: 0, quoteVolume: 0} as a no-data slot', () => {
        const pd = new PriceData({price: 0, source: 'test', ts: 0})
        expect(pd.volume).toBe(0n)
        expect(pd.quoteVolume).toBe(0n)
        //toPlainObject mirrors the wire format
        expect(pd.toPlainObject()).toEqual({volume: 0n, quoteVolume: 0n, source: 'test'})
    })

    it('calcCrossPrice(usdPrice, PRICE_SCALE) inverts the rate as expected', () => {
        const {calcCrossPrice, PRICE_SCALE} = require('../src/utils')
        const usdPriceBigInt = priceToBigInt('3.8656') //PLN per USD
        const pln = calcCrossPrice(usdPriceBigInt, PRICE_SCALE) //= USD per PLN
        //Expected: 1/3.8656 ≈ 0.2587, expressed at 14-decimal scale.
        //Compute the expected value the same way the production code would.
        const expected = (PRICE_SCALE * PRICE_SCALE) / usdPriceBigInt
        expect(pln).toBe(expected)
        //Sanity: must be way smaller than usdPriceBigInt (not equal — that's the bug)
        expect(pln).toBeLessThan(usdPriceBigInt)
        //Sanity: roughly 0.25-0.26 in 14-dec, allow a small tolerance
        expect(pln).toBeGreaterThan(25_000_000_000_000n) //0.25 * 10^14
        expect(pln).toBeLessThan(27_000_000_000_000n)   //0.27 * 10^14
    })
})
