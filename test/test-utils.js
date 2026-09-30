/*eslint-disable no-undef */

const {normalizeTimestamp} = require('../src/utils')

/**
 * @typedef {import('../src/providers/price-provider-base')} PriceProviderBase
 */

const timeframe = 1

/**
 * Fetch the provider's prices for a past minute and check one well-known symbol
 * @param {PriceProviderBase} provider - provider under test
 * @param {string} symbol - symbol that must be quoted, e.g. `EUR`
 * @param {number} count - how many minutes back from the previous minute to request
 * @returns {Promise<bigint>} price of the symbol as volume * 10^14 / quoteVolume
 */
async function getPriceTest(provider, symbol, count) {
    const ts = getTimestamp() - timeframe * 60 * count
    const tradesData = await provider.getTradesData(ts)
    expect(tradesData).toBeTruthy()
    const priceData = tradesData[symbol]
    expect(priceData).toBeDefined()
    expect(priceData.volume).toBeGreaterThan(0n)
    expect(priceData.quoteVolume).toBe(10n ** 14n)
    //mirror reflector-node's getVWAP convention: volume * 10^decimals / quoteVolume
    const price = (priceData.volume * (10n ** 14n)) / priceData.quoteVolume
    expect(price).toBeGreaterThan(0n)
    return price
}

/**
 * @returns {number} start of the previous minute, in seconds
 */
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
