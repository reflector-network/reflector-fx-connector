/*eslint-disable class-methods-use-this */
const AbstractApiProvider = require('./providers/abstract-api-provider')
const ApiLayerProvider = require('./providers/apilayer-provider')
const ECBPriceProvider = require('./providers/ecb-provider')
const ExchangerateApiProvider = require('./providers/exchangerate-api-provider')
const ForexRateApiProvider = require('./providers/forexrateapi-provider')
const NBPPriceProvider = require('./providers/nbp-provider')
const PriceProviderBase = require('./providers/price-provider-base')
const RequestError = require('./providers/request-error')

/**
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

const defaultFetchOptions = {sources: {'nbp': {}, 'ecb': {}}} //two that don't require an API key

/**
 * @typedef {Object} PriceData
 * @property {BigInt} volume - price scaled to 14 decimals
 * @property {BigInt} quoteVolume - synthetic denominator (10^14) so downstream VWAP recovers the price
 * @property {string} source
 */

/**
 * @param {string[]} sources - configured sources by name
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
            default:
                console.warn({msg: 'Unknown source', source})
        }
    }
    return providers
}

const maxAttempts = 3
const retryDelay = 200

/**
 * @param {number} ms - delay in milliseconds
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Fetch one provider's data, retrying only failures that can succeed on retry (transport errors, timeouts, 429, 5xx)
 * with a linear back-off. Provider bugs and deterministic upstream answers are not retried.
 * @param {PriceProviderBase} provider - provider to query
 * @param {number} timestamp - tick timestamp in seconds
 * @param {number} timeout - per-request timeout in milliseconds
 * @returns {Promise<TradeData[]|[]>}
 */
async function fetchTradesData(provider, timestamp, timeout) {
    const errors = []
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const tradesData = await provider.getTradesData(timestamp, timeout)
            if (!tradesData) {
                console.debug({msg: 'No data from provider', provider: provider.name})
                return []
            }
            return tradesData
        } catch (error) {
            errors.push(error.message)
            if (!(error instanceof RequestError) || !error.retryable || attempt === maxAttempts)
                break
            await sleep(retryDelay * attempt)
        }
    }
    console.warn({msg: 'Failed to get data from provider', provider: provider.name, errors})
    return []
}

class ForexPriceProvider {
    /**
     * Gets aggregated prices from multiple providers
     * @param {string[]} assets - list of asset names
     * @param {string} baseAsset - base asset name
     * @param {number} from - tick timestamp UNIX in seconds (the name reflector-node uses)
     * @param {number} [timestamp] - deprecated alias of `from`
     * @param {number} period - timeframe in seconds
     * @param {number} count - number of candles to get before the timestamp
     * @param {FetchOptions} options - fetch options
     * @returns {Promise<AggregatedTradeData>} `count` slots of `assets.length` arrays; only the last slot is populated
     */
    async getPriceData({assets, baseAsset, from, timestamp, period, count, options = null}) {
        timestamp = from ?? timestamp
        if (!Number.isFinite(timestamp) || timestamp <= 0)
            throw new Error('Invalid timestamp')
        if (assets.length === 0)
            return []
        if (baseAsset !== 'USD')
            throw new Error('Only USD base asset is supported')
        if (period % 60 !== 0)
            throw new Error('Timeframe should be whole minutes')
        period = period / 60
        if (period > 60)
            throw new Error('Timeframe should be less than or equal to 60 minutes')

        const {sources, timeout} = {...defaultFetchOptions, ...options}

        const fetchPromises = []
        const providers = getSupportedProviders(sources)
        const normalizedTradesTimestamp = timestamp + (period * 60 * (count - 1))
        for (const provider of providers) {
            const providerTradesDataPromise = fetchTradesData(provider, normalizedTradesTimestamp, timeout)
            fetchPromises.push(providerTradesDataPromise)
        }
        const providersResult = await Promise.all(fetchPromises)
        const tradesData = Array.from({length: count}, () => Array.from({length: assets.length}, () => []))
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

    setGateway(gatewayOptions, gatewayValidationKey, useCurrentProvider = false) {
        PriceProviderBase.setGateway(gatewayOptions, gatewayValidationKey, useCurrentProvider)
    }

    dispose() {
        PriceProviderBase.disposeAll()
    }
}

ForexPriceProvider.fetchTradesData = fetchTradesData //exposed for tests

module.exports = ForexPriceProvider