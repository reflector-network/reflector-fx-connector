const {DECIMALS, PRICE_SCALE} = require('../utils')

/**
 * Convert arbitrary stringified amount to int64 representation
 * @param {string|number} value - amount to convert
 * @param {number} decimals - number of decimal places
 * @return {BigInt}
 */
function priceToBigInt(value, decimals = DECIMALS) {
    if (!value)
        return 0n
    if (typeof value === 'number') {
        value = value.toFixed(decimals)
    }
    if (typeof value !== 'string' || !/^-?[\d.,]+$/.test(value))
        return 0n //invalid format
    try {
        const [int, decimal] = value.split('.', 2)
        let res = BigInt(int) * (10n ** BigInt(decimals))
        if (decimal) {
            res += BigInt(decimal.slice(0, decimals).padEnd(decimals, '0'))
        }
        return res
    } catch (e) {
        return 0n
    }
}


class PriceData {
    /**
     * @param {{price: (number|string|BigInt), source: string, ts: number}} raw - raw data
     */
    constructor(raw) {
        const {price, source, ts} = raw
        const p = typeof price === 'bigint' ? price : priceToBigInt(price)
        this.volume = p              //= price scaled to 14 decimals
        this.quoteVolume = PRICE_SCALE //= 10^14, synthetic denominator so VWAP recovers the price
        this.source = source
        this.ts = ts                 //kept for debugging only, stripped from toPlainObject
    }

    /**
     * @type {BigInt}
     * @readonly
     */
    volume

    /**
     * @type {BigInt}
     * @readonly
     */
    quoteVolume

    /**
     * @type {string}
     * @readonly
     */
    source

    toJSON() {
        return this.toPlainObject()
    }

    toPlainObject() {
        return {
            volume: this.volume,
            quoteVolume: this.quoteVolume,
            source: this.source
        }
    }
}

module.exports = PriceData
module.exports.priceToBigInt = priceToBigInt
