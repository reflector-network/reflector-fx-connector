const DECIMALS = 14
const PRICE_SCALE = 10n ** BigInt(DECIMALS)

/**
 * Calculate cross price
 * @param {BigInt} basePrice - base price in BigInt
 * @param {BigInt} price - price in BigInt
 * @returns {BigInt} - cross price in BigInt
 */
function calcCrossPrice(basePrice, price) {
    if (basePrice === 0n || price === 0n)
        return 0n
    return (price * PRICE_SCALE) / basePrice
}

/**
 * Normalize timestamp to the nearest timeframe
 * @param {number} timestamp - timestamp
 * @param {number} timeframe - timeframe to normalize to
 * @returns {number} - normalized timestamp
 */
function normalizeTimestamp(timestamp, timeframe) {
    return Math.floor(timestamp / timeframe) * timeframe
}

module.exports = {
    calcCrossPrice,
    normalizeTimestamp,
    DECIMALS,
    PRICE_SCALE
}