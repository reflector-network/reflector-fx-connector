/**
 * Convert arbitrary stringified amount to int64 representation
 * @param {string|number} value - amount to convert
 * @param {number} decimals - number of decimal places
 * @return {BigInt}
 */
function priceToBigInt(value, decimals = 7) {
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
     *
     * @param {{price: (number|string|BigInt), source: string, ts: number}} raw - raw data
     */
    constructor(raw) {
        const {price, source} = raw
        this.price = typeof price === 'bigint' ? price : priceToBigInt(price)
        this.source = source
        this.ts = raw.ts
        this.type = 'price'
    }

    /**
     * @type {BigInt}
     * @readonly
     */
    price

    /**
     * @type {string}
     * @readonly
     */
    source

    toJSON() {
        return JSON.stringify(this.toPlainObject())
    }

    toPlainObject() {
        return {
            price: this.price,
            type: this.type,
            //ts: this.ts,
            source: this.source
        }
    }
}

module.exports = PriceData