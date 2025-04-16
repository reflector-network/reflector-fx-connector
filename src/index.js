/*eslint-disable*/
const AbstractApiProvider = require('./providers/abstract-api-provider')
const ApiLayerProvider = require('./providers/apilayer-provider')
const ECBPriceProvider = require('./providers/ecb-provider')
const ExchangerateApiProvider = require('./providers/exchangerate-api-provider')
const ForexRateApiProvider = require('./providers/forexrateapi-provider')
const FXRatesApiProvider = require('./providers/fxratesapi-provider')
const NBPPriceProvider = require('./providers/nbp-provider')
const PriceProviderBase = require('./providers/price-provider-base')

/**
 * @typedef {import('./models/asset')} Asset
 * @typedef {import('./models/price-data')} TradeData
 * @typedef {import('./providers/price-provider-base')} PriceProviderBase
 */

/**
 * @typedef {TradeData[]} AssetTradeData
 * An array of trades from multiple sources for a single asset.
 */

/**
 * @typedef {AssetTradeData[]} TimestampTradeData
 * An array of asset trade data for a single timestamp.
 */

/**
 * @typedef {TimestampTradeData[]} AggregatedTradeData
 * An array of timestamped trade data for multiple assets.
 */

/**
 * @typedef {Object} FetchOptions
 * @property {Object.<string, {apiKey: string, secret:string}>} [sources] - list of sources to fetch data from
 * @property {number} [timeout] - request timeout
 */

const defaultFetchOptions = { sources: {'npb': {}, 'ecb': {}} } //two that don't require an API key

/**
 * @typedef {Object} PriceData
 * @property {BigInt} price
 * @property {string[]} sources
 */

/**
 * @param {string[]} sources
 * @returns {PriceProviderBase[]}
 */
function getSupportedProviders(sources) {
    const providers = []
    for (const source of Object.keys(sources)) {
        switch (source) {
            case 'apilayer':
                providers.push(new ApiLayerProvider(sources[source].apiKey, sources[source].secret))
                break
            case 'nbp':
                providers.push(new NBPPriceProvider(sources[source].apiKey, sources[source].secret))
                break
            case 'ecb':
                providers.push(new ECBPriceProvider(sources[source].apiKey, sources[source].secret))
                break
            case 'abstractapi':
                providers.push(new AbstractApiProvider(sources[source].apiKey, sources[source].secret))
                break
            case 'exchangerate':
                providers.push(new ExchangerateApiProvider(sources[source].apiKey, sources[source].secret))
                break
            case 'forexrateapi':
                providers.push(new ForexRateApiProvider(sources[source].apiKey, sources[source].secret))
                break
            case 'fxratesapi':
                providers.push(new FXRatesApiProvider(sources[source].apiKey, sources[source].secret))
                break
            default:
                console.warn(`Unknown source: ${source}`)
        }
    }
    return providers
}


/**
 * @param {PriceProviderBase} provider
 * @param {number} timestamp
 * @param {number} timeout
 * @returns {Promise<TradeData[]>}
 */
async function fetchTradesData(provider, timestamp, timeout) {
    let tries = 3
    const errors = []
    while (tries > 0) {
        try {
            const tradesData = await provider.getTradesData(timestamp, timeout)
            if (!tradesData) {
                console.debug(`No data from ${provider.name}`)
                break
            }
            return tradesData
        } catch (error) {
            errors.push(error.message)
        } finally {
            tries--
        }
    }
    if (errors.length > 0)
        console.warn(`Failed to get data from ${provider.name}: ${errors.join(', ')}`)
    return []
}

/**
 * Gets aggregated prices from multiple providers
 * @param {string[]} assets - list of asset names
 * @param {string} baseAsset - base asset name
 * @param {number} timestamp - timestamp UNIX in seconds
 * @param {number} timeframe - timeframe in seconds
 * @param {number} count - number of candles to get before the timestamp
 * @param {FetchOptions} options - fetch options
 * @returns {Promise<AggregatedTradeData>}
 */
async function getTradesData(assets, baseAsset, timestamp, timeframe, count, options = null) {
    if (assets.length === 0)
        return []
    if (baseAsset !== 'USD')
        throw new Error('Only USD base asset is supported')
    if (timeframe % 60 !== 0) {
        throw new Error('Timeframe should be whole minutes')
    }
    timeframe = timeframe / 60
    if (timeframe > 60) {
        throw new Error('Timeframe should be less than or equal to 60 minutes')
    }

    const { sources, timeout } = { ...defaultFetchOptions, ...options }

    const fetchPromises = []
    const providers = getSupportedProviders(sources)
    const normalizedTradesTimestamp = timestamp + (timeframe * 60 * (count - 1))
    for (const provider of providers) {
        const providerTradesDataPromise = fetchTradesData(provider, normalizedTradesTimestamp, timeout)
        fetchPromises.push(providerTradesDataPromise)
    }
    const providersResult = await Promise.all(fetchPromises)
    const tradesData = Array.from({ length: count }, (i) => Array.from({ length: assets.length }, () => []))
    for (let assetIndex = 0; assetIndex < assets.length; assetIndex++) {
        const asset = assets[assetIndex]
        for (let providerIndex = 0; providerIndex < providers.length; providerIndex++) {
            const providerTradesData = providersResult[providerIndex]
            const priceData = providerTradesData[asset]
            if (!priceData)
                continue
            tradesData[count - 1][assetIndex].push(providerTradesData[asset])
        }
    }

    return tradesData
}

function setGateway(gatewayOptions, gatewayValidationKey, useCurrentProvider = false) {
    PriceProviderBase.setGateway(gatewayOptions, gatewayValidationKey, useCurrentProvider)
}

module.exports = { getTradesData, setGateway }