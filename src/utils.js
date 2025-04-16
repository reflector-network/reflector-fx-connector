/**
 * Calculate cross price
 * @param {BigInt} basePrice - base price in BigInt
 * @param {BigInt} price - price in BigInt
 * @returns {BigInt} - cross price in BigInt
 */
function calcCrossPrice(basePrice, price) {
    return (price * (10n ** BigInt(7))) / basePrice
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
    normalizeTimestamp
}