/*eslint-disable class-methods-use-this */
const https = require('https')
const http = require('http')
const {default: axios} = require('axios')
const PriceData = require('../models/price-data')

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

function ensureCache(providerName) {
    let providerCache = cache.get(providerName)
    if (!providerCache) {
        providerCache = new Map()
        cache.set(providerName, providerCache)
    }
    return providerCache
}

class PriceProviderBase {
    constructor(apiKey, secret) {
        if (this.constructor === PriceProviderBase)
            throw new Error('PriceProviderBase is an abstract class and cannot be instantiated')
        this.apiKey = apiKey
        this.secret = secret
    }

    __setCacheData(key, value) {
        ensureCache(this.name).set(key, value)
    }

    __clearCache() {
        ensureCache(this.name).clear()
    }

    //get cloned cached data with updated timestamp, if available
    __tryGetCachedData(key, timestamp) {
        const cachedData = ensureCache(this.name).get(key)
        if (!cachedData)
            return null
        //clone and update timestamp
        return Object.entries(cachedData).reduce((acc, [symbol, priceData]) => {
            acc[symbol] = new PriceData({
                price: priceData.price,
                source: priceData.source,
                ts: timestamp
            })
            return acc
        }, {})
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
     * @protected
     */
    async __makeRequest(url, options = {}) {
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