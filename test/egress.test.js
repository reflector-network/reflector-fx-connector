/*eslint-disable no-undef */
const http = require('http')
const net = require('net')
const zlib = require('zlib')
const {default: axios} = require('axios')
const PriceProviderBase = require('../src/providers/price-provider-base')
const RequestError = require('../src/providers/request-error')

let server
let baseUrl
let gatewayHits = 0
let directHits = 0

/**
 * @param {http.IncomingMessage} req - request
 * @param {http.ServerResponse} res - response
 */
function handle(req, res) {
    const {pathname, searchParams} = new URL(req.url, 'http://127.0.0.1')
    if (pathname === '/gateway') {
        gatewayHits++
        if (new URL(searchParams.get('url')).pathname === '/gateway-down') {
            res.writeHead(502)
            res.end()
            return
        }
        res.writeHead(200, {'content-type': 'application/json'})
        res.end(JSON.stringify({price: 1, seen: req.headers['x-gateway-validation'] ?? null}))
        return
    }
    switch (pathname) {
        case '/ok':
        case '/gateway-down':
            directHits++
            res.writeHead(200, {'content-type': 'application/json'})
            res.end(JSON.stringify({price: 1, seen: req.headers['x-gateway-validation'] ?? null}))
            break
        case '/slow': {
            res.writeHead(200, {'content-type': 'application/json'})
            res.write('[')
            const drip = setInterval(() => res.write('1,'), 200)
            req.on('close', () => clearInterval(drip))
            break
        }
        case '/big':
            res.writeHead(200, {'content-type': 'text/plain'})
            res.end(Buffer.alloc(6 * 1024 * 1024, 97))
            break
        case '/truncated':
            res.writeHead(200, {'content-type': 'application/json', 'content-length': '1000'})
            res.write('12345678')
            res.destroy()
            break
        case '/bomb':
            res.writeHead(200, {'content-encoding': 'gzip', 'content-type': 'text/plain'})
            res.end(zlib.gzipSync(Buffer.alloc(6 * 1024 * 1024, 97)))
            break
        case '/redirect':
            res.writeHead(302, {location: `${baseUrl}/ok`})
            res.end()
            break
        case '/rate-limited':
            res.writeHead(429)
            res.end()
            break
        case '/broken':
            res.writeHead(500)
            res.end()
            break
        default:
            res.writeHead(404)
            res.end()
    }
}

beforeAll(async () => {
    server = http.createServer(handle)
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${server.address().port}`
    jest.spyOn(console, 'debug').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterAll(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    jest.restoreAllMocks()
})

afterEach(() => {
    PriceProviderBase.setGateway(null)
    gatewayHits = 0
    directHits = 0
    console.warn.mockClear()
    console.error.mockClear()
})

describe('makeRequest egress limits', () => {
    test('returns the response for a healthy upstream', async () => {
        const response = await PriceProviderBase.makeRequest(`${baseUrl}/ok`)
        expect(response.data.price).toBe(1)
    })

    test('abandons a slow-drip response at the deadline and marks it retryable', async () => {
        const start = Date.now()
        const error = await PriceProviderBase.makeRequest(`${baseUrl}/slow`, {timeout: 500}).catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        expect(error.retryable).toBe(true)
        expect(Date.now() - start).toBeLessThan(3000)
    })

    test('caps the deadline even when a provider asks for a minute', async () => {
        expect(PriceProviderBase.maxDeadline).toBe(10000)
        const start = Date.now()
        const error = await PriceProviderBase.makeRequest(`${baseUrl}/slow`, {timeout: 60 * 1000}).catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        const elapsed = Date.now() - start
        expect(elapsed).toBeGreaterThan(8000)
        expect(elapsed).toBeLessThan(13500)
    }, 15000)

    test('rejects an oversized body as a deterministic failure', async () => {
        const error = await PriceProviderBase.makeRequest(`${baseUrl}/big`).catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        expect(error.retryable).toBe(false)
    })

    test('does not follow redirects', async () => {
        const error = await PriceProviderBase.makeRequest(`${baseUrl}/redirect`).catch(e => e)
        expect(error.status).toBe(302)
        expect(error.retryable).toBe(false)
    })

    test('a provider cannot loosen the egress limits with per-request options', async () => {
        let error = await PriceProviderBase.makeRequest(`${baseUrl}/redirect`, {maxRedirects: 5}).catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        expect(error.status).toBe(302)

        error = await PriceProviderBase.makeRequest(`${baseUrl}/big`, {maxContentLength: Infinity, maxBodyLength: Infinity}).catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        expect(error.retryable).toBe(false)

        error = await PriceProviderBase.makeRequest(`${baseUrl}/redirect`, {validateStatus: () => true}).catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        expect(error.status).toBe(302)
    })

    test('a 2xx that dies mid-body is retryable', async () => {
        const error = await PriceProviderBase.makeRequest(`${baseUrl}/truncated`).catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        if (error.status !== null)
            expect(error.status).toBe(200)
        expect(error.retryable).toBe(true)
    })

    test('rejects a compressed body that inflates past the cap', async () => {
        const error = await PriceProviderBase.makeRequest(`${baseUrl}/bomb`).catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        expect(error.retryable).toBe(false)
    })

    test('rejects an invalid url without leaking it into the error', async () => {
        const error = await PriceProviderBase.makeRequest('not a url').catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        expect(error.host).toBe('invalid-url')
        expect(error.retryable).toBe(false)
        expect(error.message).not.toContain('not a url')
    })

    test('composes a caller signal with the deadline', async () => {
        const controller = new AbortController()
        controller.abort()
        const error = await PriceProviderBase.makeRequest(`${baseUrl}/ok`, {signal: controller.signal}).catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        expect(error.code).toBe('ERR_CANCELED')
        expect(error.retryable).toBe(true)
    })

    test('classifies rate limits and server errors as retryable, client errors as not', async () => {
        expect((await PriceProviderBase.makeRequest(`${baseUrl}/rate-limited`).catch(e => e)).retryable).toBe(true)
        expect((await PriceProviderBase.makeRequest(`${baseUrl}/broken`).catch(e => e)).retryable).toBe(true)
        expect((await PriceProviderBase.makeRequest(`${baseUrl}/missing`).catch(e => e)).retryable).toBe(false)
    })

    test('logs the host and status but neither the api key nor the url', async () => {
        await PriceProviderBase.makeRequest(`${baseUrl}/broken?access_key=SECRET123`).catch(() => {})
        expect(console.warn).toHaveBeenCalledTimes(1)
        const logged = JSON.stringify(console.warn.mock.calls[0])
        expect(logged).not.toContain('SECRET123')
        expect(logged).not.toContain('/broken')
        expect(console.warn.mock.calls[0][0].status).toBe(500)
        expect(console.warn.mock.calls[0][0].host).toContain('127.0.0.1')
    })

    test('leaves the process-global axios defaults untouched', () => {
        expect(axios.defaults.httpAgent).toBeUndefined()
        expect(axios.defaults.httpsAgent).toBeUndefined()
    })

    test('setGateway copies the array it is given and sends the header to the gateway', async () => {
        const list = [baseUrl]
        PriceProviderBase.setGateway(list, 'key', true)
        expect(list).toEqual([baseUrl])
        expect(PriceProviderBase.gatewayUrls).toEqual([undefined, baseUrl])
        PriceProviderBase.setGateway([baseUrl], 'key')
        const response = await PriceProviderBase.makeRequest('https://upstream.example/ok')
        expect(response.data.seen).toBe('key')
    })
})

test('an unparseable gateway is dropped and never named in a log', () => {
    PriceProviderBase.setGateway(['http://user:TOPSECRET@', 'http://gw-a'], 'key')
    expect(PriceProviderBase.gatewayUrls).toEqual(['http://gw-a'])
    expect(JSON.stringify(console.warn.mock.calls)).not.toContain('TOPSECRET')
})

describe('a configured gateway is never bypassed by a direct request', () => {
    test('a failing gateway is not retried directly', async () => {
        PriceProviderBase.setGateway([baseUrl], 'key')
        const error = await PriceProviderBase.makeRequest(`${baseUrl}/gateway-down`).catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        expect(error.status).toBe(502)
        expect(gatewayHits).toBe(1)
        expect(directHits).toBe(0) //the node ip never reached the upstream
    })

    test('a list of only unusable gateways fails closed instead of going direct', async () => {
        PriceProviderBase.setGateway(['http://user:TOPSECRET@', 42], 'key')
        expect(PriceProviderBase.gatewayUrls).toEqual([]) //configured but unusable, which is not the same as unconfigured
        const error = await PriceProviderBase.makeRequest(`${baseUrl}/ok`).catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        expect(error.code).toBe('ERR_NO_GATEWAY')
        expect(error.retryable).toBe(false)
        expect(directHits).toBe(0)
        expect(gatewayHits).toBe(0)
        //loud, and specific about how many were configured and why each was dropped, without naming any of them
        expect(console.error).toHaveBeenCalledTimes(1)
        expect(console.error.mock.calls[0][0].configured).toBe(2)
        expect(console.error.mock.calls[0][0].reasons).toEqual(['#0: unparseable', '#1: not-a-string (number)'])
        expect(JSON.stringify(console.error.mock.calls)).not.toContain('TOPSECRET')
    })

    test('an empty list means no gateways configured, so direct stays the only route', async () => {
        PriceProviderBase.setGateway([], 'key')
        expect(PriceProviderBase.gatewayUrls).toBeNull()
        expect(console.error).not.toHaveBeenCalled()
        const response = await PriceProviderBase.makeRequest(`${baseUrl}/ok`)
        expect(response.data.price).toBe(1)
        expect(directHits).toBe(1)
    })

    test('useCurrentProvider keeps the local host as one of the rotated routes', async () => {
        PriceProviderBase.setGateway([baseUrl], 'key', true)
        expect(PriceProviderBase.gatewayUrls).toEqual([undefined, baseUrl])
        //two slots, so two consecutive requests to the same host take one each: one gateway, one local host
        await PriceProviderBase.makeRequest(`${baseUrl}/ok`)
        await PriceProviderBase.makeRequest(`${baseUrl}/ok`)
        expect(gatewayHits).toBe(1)
        expect(directHits).toBe(1)
    })
})

describe('a configured entry that is not a routable url fails closed', () => {
    //counted at the socket, so an outbound attempt is seen even when nothing ever answers it
    let socketAttempts = 0
    const realConnect = net.Socket.prototype.connect

    beforeAll(() => {
        net.Socket.prototype.connect = function (...args) {
            socketAttempts++
            return realConnect.apply(this, args)
        }
    })

    afterAll(() => {
        net.Socket.prototype.connect = realConnect
    })

    beforeEach(() => {
        socketAttempts = 0
    })

    //`undefined` is also how useCurrentProvider names the
    //local host; a configured list holding nothing else must still fail closed rather than send every request direct
    test.each([
        {name: 'a single undefined entry', build: () => [undefined]},
        {name: 'three undefined entries', build: () => [undefined, undefined, undefined]},
        {name: 'an array of holes', build: () => new Array(3)},
        {name: 'a hole followed by a null', build: () => {
            const list = new Array(2)
            list.push(null)
            return list
        }},
        {name: 'a null entry', build: () => [null]},
        {name: 'an empty string', build: () => ['']},
        {name: 'whitespace', build: () => ['   ']},
        {name: 'a number', build: () => [42]},
        {name: 'an object', build: () => [{url: 'http://gw-a'}]},
        {name: 'an array', build: () => [['http://gw-a']]},
        {name: 'a boolean', build: () => [false]}
    ])('$name is not a usable gateway, so the request fails closed', async ({build}) => {
        PriceProviderBase.setGateway(build(), 'key')
        expect(PriceProviderBase.gatewayUrls).toEqual([]) //configured with nothing usable, which is not unconfigured
        const error = await PriceProviderBase.makeRequest(`${baseUrl}/ok`).catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        expect(error.code).toBe('ERR_NO_GATEWAY')
        expect(directHits).toBe(0) //nothing reached the upstream
        expect(gatewayHits).toBe(0)
        expect(socketAttempts).toBe(0) //and no socket was opened for it at all
    })

    test('useCurrentProvider does not turn a caller-supplied undefined into a route', async () => {
        PriceProviderBase.setGateway([undefined], 'key', true)
        expect(PriceProviderBase.gatewayUrls).toEqual([]) //the opt-in is added after the fail-closed return, not before
        const error = await PriceProviderBase.makeRequest(`${baseUrl}/ok`).catch(e => e)
        expect(error.code).toBe('ERR_NO_GATEWAY')
        expect(directHits).toBe(0)
        expect(socketAttempts).toBe(0)
    })

    test('a hole before a real gateway leaves the real gateway usable', async () => {
        const sparse = new Array(2)
        sparse.push(baseUrl)
        PriceProviderBase.setGateway(sparse, 'key')
        expect(PriceProviderBase.gatewayUrls).toEqual([baseUrl]) //the holes are dropped, the gateway is kept
        const response = await PriceProviderBase.makeRequest('https://upstream.example/ok')
        expect(response.data.seen).toBe('key')
        expect(gatewayHits).toBe(1)
        expect(directHits).toBe(0)
    })

    test('the opt-in local host is still a rotation slot, because it is added after the filter', async () => {
        PriceProviderBase.setGateway([baseUrl], 'key', true)
        expect(PriceProviderBase.gatewayUrls).toEqual([undefined, baseUrl])
        //two slots, so two consecutive requests to the same host take one each: one gateway, one local host
        await PriceProviderBase.makeRequest(`${baseUrl}/ok`)
        await PriceProviderBase.makeRequest(`${baseUrl}/ok`)
        expect(gatewayHits).toBe(1)
        expect(directHits).toBe(1)
    })
})
