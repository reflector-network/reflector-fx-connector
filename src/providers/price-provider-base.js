/*eslint-disable class-methods-use-this */
const https = require('https')
const http = require('http')
const {default: axios} = require('axios')
const PriceData = require('../models/price-data')
const {normalizeTimestamp} = require('../utils')
const RequestError = require('./request-error')

//egress limits shared by every request: a total deadline, a body cap, no redirects
const maxDeadline = 10000
const maxBodyBytes = 5 * 1024 * 1024
const defaultAgentOptions = {keepAlive: true, maxSockets: 50, noDelay: true}

//only a 2xx is a success; used for both the client defaults and the per-request options so a provider cannot loosen it
const acceptedStatus = status => status >= 200 && status < 300

const requestedUrls = new Map()

//a dedicated client, so the process-global axios defaults stay untouched and no other package can undo the limits
const client = axios.create({
    httpAgent: new http.Agent(defaultAgentOptions),
    httpsAgent: new https.Agent(defaultAgentOptions),
    maxRedirects: 0,
    maxContentLength: maxBodyBytes,
    maxBodyLength: maxBodyBytes,
    validateStatus: acceptedStatus
})

/**
 * @param {number} index - current index
 * @param {number} length - list length
 * @returns {number}
 */
function getRotatedIndex(index, length) {
    return (index + 1) % length
}

const cache = new Map()
const timeoutHandles = new Map()
const disposedProviders = new Set()

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
            price: priceData.volume,
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
    if (disposedProviders.has(providerName))
        return
    let timeout
    try {

        const normalizedTs = normalizeTimestamp(Date.now(), interval)
        const cachedData = cache.get(providerName)
        console.debug({msg: 'Running cache worker', provider: providerName, cachedTimestamp: cachedData?.timestamp, normalizedTs})
        if (cachedData && cachedData.timestamp === normalizedTs) {
            //assign timeout before returning; otherwise the finally below schedules at 0ms and busy-loops
            timeout = Math.max(normalizedTs + interval + syncDelay - Date.now(), 1000)
            return //data already cached for this timestamp
        }
        const priceData = await workerFn(api, secret)
        if (disposedProviders.has(providerName))
            return //disposed during fetch
        console.debug({msg: 'Cache worker completed', provider: providerName})
        //add to cache
        setCacheData(providerName, priceData, normalizedTs)
        timeout = Math.max(normalizedTs + interval + syncDelay - Date.now(), 1000)
    } catch (err) {
        console.error({msg: 'Error getting trade data', provider: providerName, err})
        timeout = 60 * 1000 //retry in 1 minute
    } finally {
        if (!disposedProviders.has(providerName)) {
            const handle = setTimeout(() => {
                runWorker(providerName, workerFn, api, secret, interval)
            }, timeout)
            timeoutHandles.set(providerName, handle)
        }
    }
}

/**
 * @param {string} [gatewayUrl] - gateway url, or undefined for a direct request
 * @returns {string|null} gateway host for logs; never throws and never carries credentials
 */
function gatewayHost(gatewayUrl) {
    if (!gatewayUrl)
        return null
    try {
        return new URL(gatewayUrl).host
    } catch (e) {
        return 'invalid-gateway'
    }
}

/**
 * Judges one entry of the operator's configured list. The direct route is never judged here: it is not a configured
 * entry, `setGateway` injects it after this filter has run. An `undefined` that arrived from the caller - a literal
 * `[undefined]`, or an array hole the spread turns into one - is therefore rejected like any other non-string
 * instead of being read as the opt-in local host and sending the request direct.
 * @param {any} gatewayUrl - configured gateway entry
 * @returns {string|null} why the entry cannot be used, or null when it can; the entry itself is never echoed back
 */
function gatewayRejectionReason(gatewayUrl) {
    if (typeof gatewayUrl !== 'string') //undefined and null included: neither of them names a route
        return `not-a-string (${typeof gatewayUrl})`
    let parsed
    try {
        parsed = new URL(gatewayUrl)
    } catch (e) {
        return 'unparseable'
    }
    return parsed.host ? null : 'no-host'
}

/**
 * @param {any} gatewayUrl - configured gateway entry
 * @returns {boolean} true when the entry is usable, so an unusable one never reaches the gateway list
 */
function isUsableGateway(gatewayUrl) {
    return gatewayRejectionReason(gatewayUrl) === null
}

/**
 * @returns {boolean} true when gateways were configured and none of them is usable: there is no route left, and a
 * direct request would reveal the node ip to the upstream, which is the one thing the gateways exist to prevent
 */
function hasNoUsableGateway() {
    return Array.isArray(PriceProviderBase.gatewayUrls) && PriceProviderBase.gatewayUrls.length === 0
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
            if (cache.has(this.name) && !disposedProviders.has(this.name))
                return //worker already running
            //clear any prior disposed state so the worker restarts on re-construction
            disposedProviders.delete(this.name)
            //initialize cache
            setCacheData(this.name, {}, 0)
            //run worker to load price data
            runWorker(this.name, cacheWorkerOptions.loadPriceDataFn, this.apiKey, this.secret, cacheWorkerOptions.interval)
        }
    }

    /**
     * Stop the cache worker for this provider and clear its pending timer.
     * The last-fetched cache entry is retained so getTradesData can still serve it.
     */
    dispose() {
        disposedProviders.add(this.name)
        const handle = timeoutHandles.get(this.name)
        if (handle) {
            clearTimeout(handle)
            timeoutHandles.delete(this.name)
        }
    }

    /**
     * Stop all cache workers and clear all pending timers. Mainly useful for test teardown.
     */
    static disposeAll() {
        for (const [providerName, handle] of timeoutHandles) {
            clearTimeout(handle)
            disposedProviders.add(providerName)
        }
        timeoutHandles.clear()
    }

    /**
     * Records one of three states in `gatewayUrls`, and only the first of them may issue a direct request.
     * `null` - no gateways configured, so direct is the only route.
     * A non-empty list - at least one usable gateway: every request goes through a gateway, and direct is used only
     * when `useCurrentProvider` put it in the list and the rotation picks that slot.
     * An empty list - gateways configured and none of them usable: no route at all, so requests fail instead of
     * revealing the node ip to the upstream.
     * @param {string|string[]} gatewayConnectionSting - configured gateway urls
     * @param {string} validationKey - value of the x-gateway-validation header
     * @param {boolean} [useCurrentProvider] - route through the local host as well, as one explicitly chosen route;
     * this is the only thing that puts the direct route in the list
     */
    static setGateway(gatewayConnectionSting, validationKey, useCurrentProvider) {
        if (!gatewayConnectionSting) {
            PriceProviderBase.gatewayUrls = null
            PriceProviderBase.validationKey = null
            return
        }

        if (!Array.isArray(gatewayConnectionSting))
            gatewayConnectionSting = [gatewayConnectionSting]

        const configured = [...gatewayConnectionSting]
        //an empty list is "no gateways configured", not a configuration that failed: reflector-node synthesises
        //{urls: []} the first time a node boots without a gateways.json (src/domain/settings-manager.js:92-96) and
        //hands that straight to setGateway, so fail-closing here would leave every freshly provisioned node unable
        //to fetch any data at all
        if (configured.length === 0) {
            PriceProviderBase.gatewayUrls = null
            PriceProviderBase.validationKey = null
            return
        }
        //an unusable entry would throw out of every log line, so drop it here and never name it
        const gateways = configured.filter(isUsableGateway)

        if (gateways.length === 0) {
            //fail closed: going direct would expose the node ip, which is the one thing the gateways exist to prevent
            const reasons = configured.map((gateway, index) => `#${index}: ${gatewayRejectionReason(gateway)}`)
            console.error({msg: 'Every configured gateway is unusable; requests will fail instead of going direct', configured: configured.length, reasons})
            PriceProviderBase.gatewayUrls = []
            PriceProviderBase.validationKey = null
            return
        }

        if (gateways.length !== configured.length)
            console.warn({msg: 'Ignored unparseable gateway urls', ignored: configured.length - gateways.length, kept: gateways.length})

        //the only undefined that can reach the list: it is added after the configured entries were validated and
        //after the fail-closed return, so a caller-supplied undefined can never pass for the opt-in local host
        if (useCurrentProvider) //add current server as one more chosen route, never as a fall-back
            gateways.unshift(undefined)

        PriceProviderBase.gatewayUrls = gateways
        PriceProviderBase.validationKey = validationKey
    }

    static getGatewayUrl(url) {
        const gateways = PriceProviderBase.gatewayUrls
        //an empty list is the fail-closed state; makeRequest refuses the request before it gets here
        if (!gateways || gateways.length === 0) //no proxies
            return undefined

        if (gateways.length === 1) //single gateway, no need to rotate
            return gateways[0]

        const host = new URL(url).host
        if (!requestedUrls.has(host)) {//first request to the host. Assign first gateway
            requestedUrls.set(host, 0)
            return gateways[0]
        }
        const index = requestedUrls.get(host)
        const newIndex = getRotatedIndex(index, gateways.length)
        requestedUrls.set(host, newIndex)
        return gateways[newIndex]
    }

    /**
     * Total deadline applied to every request, in milliseconds; a provider's own timeout is capped at it.
     * @type {number}
     */
    static maxDeadline = maxDeadline

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
     * @param {number} timestamp - timestamp in seconds
     * @param {number} timeout - request timeout in milliseconds
     * @returns {Promise<Object.<string, PriceData>[]|null>}
     * @abstract
     * @protected
     */
    //eslint-disable-next-line no-unused-vars
    __getTradeData(timestamp, timeout) {
        throw new Error('Not implemented')
    }

    /**
     * Issues one request over the rotated gateway, or directly when no gateways are configured. It never retries a
     * failed gateway request directly: that would show the node's ip to the upstream, so a failure here means the
     * tick loses this provider's data.
     * @param {string} url - request url
     * @param {any} [options] - axios request options; `timeout` is capped at `maxDeadline`
     * @returns {Promise<any>} axios response with a 2xx status
     * @throws {RequestError} on any transport or HTTP failure, or `ERR_NO_GATEWAY` when the gateways are configured
     * and none of them is usable
     * @static
     */
    static async makeRequest(url, options = {}) {
        let targetHost
        try {
            targetHost = new URL(url).host
        } catch (e) {
            throw new RequestError('invalid-url', {code: 'ERR_INVALID_URL'})
        }
        if (hasNoUsableGateway()) //fail closed before any transport call; setGateway already logged why
            throw new RequestError(targetHost, {code: RequestError.noRouteCode})
        const requested = Number(options?.timeout)
        const deadline = Math.min(requested > 0 ? requested : maxDeadline, maxDeadline)
        const gatewayUrl = PriceProviderBase.getGatewayUrl(url)
        let headers = options?.headers
        if (gatewayUrl) {
            url = `${gatewayUrl}/gateway?url=${encodeURIComponent(url)}`
            headers = {...headers, 'x-gateway-validation': PriceProviderBase.validationKey}
        }
        const requestOptions = {
            ...options,
            headers,
            url,
            timeout: deadline,
            signal: options?.signal ? AbortSignal.any([AbortSignal.timeout(deadline), options.signal]) : AbortSignal.timeout(deadline),
            maxRedirects: 0,
            maxContentLength: maxBodyBytes,
            maxBodyLength: maxBodyBytes,
            validateStatus: acceptedStatus
        }
        const start = Date.now()
        try {
            const response = await client.request(requestOptions)
            const durationMs = Date.now() - start
            if (durationMs > 1000)
                console.debug({msg: 'Slow request', host: targetHost, gateway: gatewayHost(gatewayUrl), durationMs})
            return response
        } catch (err) {
            const error = new RequestError(targetHost, {status: err.response?.status, code: err.code})
            console.warn({msg: 'Request failed', host: targetHost, gateway: gatewayHost(gatewayUrl), status: error.status, code: error.code, durationMs: Date.now() - start})
            throw error
        }
    }
}

module.exports = PriceProviderBase