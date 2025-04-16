/*eslint-disable no-undef */

const {normalizeTimestamp} = require('../src/utils')

/**
 * @typedef {import('../src/providers/price-provider-base')} PriceProviderBase
 */

const timeframe = 1

/**
 * @param {PriceProviderBase} provider
 * @param {string} source
 * @param {number} count
 * @param {boolean} expectNull
 * @returns {Promise<void>}
 */
async function getPriceTest(provider, source, count, expectNull = false) {
    const ts = getTimestamp() - timeframe * 60 * count
    const tradesData = await provider.getTradesData(ts)
    if (expectNull) {
        expect(tradesData).toBeNull()
        return null
    }
    expect(tradesData.length).toBe(count)
    const lastTrade = tradesData[tradesData.length - 1]
    const price = (lastTrade.quoteVolume === 0n || lastTrade.volume === 0n)
        ? 0n
        : (lastTrade.quoteVolume * (10n ** BigInt(7 * 2))) / lastTrade.volume  //10^7 is the default precision
    expect(price).toBeGreaterThan(0n)

    return price
}

function getTimestamp() {
    return normalizeTimestamp(Date.now() - timeframe * 60000, timeframe * 60000) / 1000
}

const assets = [
    'AUD',
    'EUR',
    'BYR',
    'AED',
    'CZK',
    'GBP',
    'XAU',
    'NON_EXISTENT_ASSET'
]

module.exports = {getPriceTest, getTimestamp, assets}