/*eslint-disable class-methods-use-this */
const https = require('https')
const http = require('http')
const {default: axios} = require('axios')
const PriceData = require('../models/price-data')
const {normalizeTimestamp} = require('../utils')

const defaultAgentOptions = {keepAlive: true, maxSockets: 50, noDelay: true}

const requestedUrls = new Map()

const httpAgent = new http.Agent(defaultAgentOptions)
axios.defaults.httpAgent = httpAgent

const httpsAgent = new https.Agent(defaultAgentOptions)
axios.defaults.httpsAgent = httpsAgent

function getRotatedIndex(index, length) {
    return (index + 1) % length
}

const cache = new Map()

function setCacheData(providerName, priceData, timestamp) {
    if (!providerName || !priceData || typeof timestamp !== 'number' || timestamp < 0)
        throw new Error('Invalid parameters for setCacheData')
    cache.set(providerName, {priceData, timestamp})
}

function tryGetCachedData(providerName, timestamp) {
    const cachedData = cache.get(providerName)
    if (!cachedData)
        return
    //clone and update timestamp
    return Object.entries(cachedData?.priceData || {}).reduce((acc, [symbol, priceData]) => {
        acc[symbol] = new PriceData({
            price: priceData.price,
            source: priceData.source,
            ts: timestamp
        })
        return acc
    }, {})
}
/**
 * delay in milliseconds for syncing price data
 */
const syncDelay = 5 * 1000

/**
 * Run a worker function periodically to load price data and cache it.
 * @param {string} providerName - Name of the provider
 * @param {Function} workerFn - Function to run periodically to load price data
 * @param {string} api - API key for the provider
 * @param {string} secret - Secret key for the provider
 * @param {number} [interval] - Timeout in milliseconds for the worker function. Defaults to 1 hour.
 * @returns {Promise<void>}
 */
async function runWorker(providerName, workerFn, api, secret, interval = 60 * 60 * 1000) {
    let timeout
    try {

        const normalizedTs = normalizeTimestamp(Date.now(), interval)
        const cachedData = cache.get(providerName)
        console.trace(`Running worker for ${providerName}. Cached data timestamp: ${cachedData?.timestamp}, current normalized timestamp: ${normalizedTs}`)
        if (cachedData && cachedData.timestamp === normalizedTs)
            return //data already cached for this timestamp
        const priceData = await workerFn(api, secret)
        console.trace(`Worker for ${providerName} completed.`)
        //add to cache
        setCacheData(providerName, priceData, normalizedTs)
        timeout = normalizedTs + interval + syncDelay - Date.now()
    } catch (err) {
        console.error({err}, `Error getting trade data from ${providerName}`)
        timeout = 60 * 1000 //retry in 1 minute
    } finally {
        setTimeout(() => {
            runWorker(providerName, workerFn, api, secret, interval)
        }, timeout)
    }
}

class PriceProviderBase {
    /**
     * @param {string} name - Name of the provider
     * @param {string} apiKey - API key for the provider
     * @param {string} secret - Secret key for the provider
     * @param {{loadPriceDataFn: Function, interval: [number]}} [cacheWorkerOptions] - Optional cache worker for background tasks
     */
    constructor(name, apiKey, secret, cacheWorkerOptions) {
        if (this.constructor === PriceProviderBase)
            throw new Error('PriceProviderBase is an abstract class and cannot be instantiated')
        this.name = name
        this.apiKey = apiKey
        this.secret = secret
        if (cacheWorkerOptions) {
            if (cache.has(this.name))
                return //worker already running
            //initialize cache
            setCacheData(this.name, {}, 0)
            //run worker to load price data
            runWorker(this.name, cacheWorkerOptions.loadPriceDataFn, this.apiKey, this.secret, cacheWorkerOptions.interval)
        }
    }

    static setGateway(gatewayConnectionSting, validationKey, useCurrentProvider) {
        if (!gatewayConnectionSting) {
            PriceProviderBase.gatewayUrls = null
            PriceProviderBase.validationKey = null
            return
        }

        if (!Array.isArray(gatewayConnectionSting))
            gatewayConnectionSting = [gatewayConnectionSting]

        const gateways = gatewayConnectionSting

        if (gateways.length === 0) {
            PriceProviderBase.gatewayUrls = null
            PriceProviderBase.validationKey = null
            return
        }

        if (useCurrentProvider) //add current server
            gateways.unshift(undefined)

        PriceProviderBase.gatewayUrls = gateways
        PriceProviderBase.validationKey = validationKey
    }

    static getGatewayUrl(url) {
        if (!PriceProviderBase.gatewayUrls) //no proxies
            return undefined

        if (PriceProviderBase.gatewayUrls.length === 1) //single gateway, no need to rotate
            return PriceProviderBase.gatewayUrls[0]

        const host = new URL(url).host
        if (!requestedUrls.has(host)) {//first request to the host. Assign first gateway
            requestedUrls.set(host, 0)
            return PriceProviderBase.gatewayUrls[0]
        }
        const index = requestedUrls.get(host)
        const newIndex = getRotatedIndex(index, PriceProviderBase.gatewayUrls.length)
        requestedUrls.set(host, newIndex)
        return PriceProviderBase.gatewayUrls[newIndex]
    }

    /**
     * @type {string}
     * @readonly
     */
    base = ''

    /**
     * @type {string}
     * @readonly
     */
    name = ''

    /**
     * @type {string}
     * @protected
     */

    apiKey
    /**
     * @type {string}
     * @protected
     */
    secret

    /**
     *
     * @param {number} timestamp - timestamp in seconds
     * @param {number} [timeout] - request timeout in milliseconds. Default is 3000ms
     * @returns {Promise<Object.<string, PriceData>[]|null>} Returns PriceData array for current timestamp
     */
    getTradesData(timestamp, timeout = 3000) {
        if (typeof timestamp !== 'number' || timestamp <= 0)
            throw new Error('Invalid timestamp')
        const priceData = tryGetCachedData(this.name, timestamp, this.apiKey, this.secret)
        if (priceData)
            return Promise.resolve(priceData)
        return this.__getTradeData(timestamp, timeout)
    }

    /**
     * @param {number} timestamp
     * @param {number} timeout
     * @returns {Promise<Object.<string, PriceData>[]|null>}
     * @abstract
     * @protected
     */
    __getTradeData(timestamp, timeout) {
        throw new Error('Not implemented')
    }

    /**
     * @param {string} url - request url
     * @param {any} [options] - request options
     * @returns {Promise<any>}
     * @static
     */
    static async makeRequest(url, options = {}) {
        const gatewayUrl = PriceProviderBase.getGatewayUrl(url)
        if (gatewayUrl) {
            url = `${gatewayUrl}/gateway?url=${encodeURIComponent(url)}`
            //add validation key
            if (!options)
                options = {}
            options.headers = {
                ...options.headers,
                'x-gateway-validation': PriceProviderBase.validationKey
            }
        }
        const requestOptions = {
            ...options,
            url
        }
        try {
            const start = Date.now()
            const response = await axios.request(requestOptions)
            const time = Date.now() - start
            requestedUrls.delete(url)
            if (time > 1000)
                console.debug(`Request to ${url} took ${time}ms. Gateway: ${gatewayUrl ? gatewayUrl : 'no'}`)
            return response
        } catch (err) {
            console.error(`Request to ${url} failed: ${err.message}. Gateway: ${gatewayUrl ? gatewayUrl : 'no'}`)
            return null
        }
    }
}

module.exports = PriceProviderBase