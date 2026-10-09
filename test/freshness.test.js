/*eslint-disable no-undef */
const nock = require('nock')
const PriceProviderBase = require('../src/providers/price-provider-base')
const ECBPriceProvider = require('../src/providers/ecb-provider')
const NBPPriceProvider = require('../src/providers/nbp-provider')
const ExchangerateApiProvider = require('../src/providers/exchangerate-api-provider')

const day = 24 * 60 * 60 * 1000
const fixingDay = '2025-04-01'
const fixingDate = Date.parse(`${fixingDay}T00:00:00Z`)

/**
 * @param {number} offsetMs - offset from the fixing date
 * @returns {number} tick timestamp in seconds
 */
function tickAt(offsetMs) {
    return Math.floor((fixingDate + offsetMs) / 1000)
}

/**
 * @param {string} date - observation day
 * @returns {object} minimal ECB jsondata payload with USD and JPY series
 */
function ecbPayload(date) {
    return {
        header: {prepared: `${date}T17:00:00.000+02:00`},
        structure: {
            dimensions: {
                series: [{id: 'FREQ', values: [{id: 'D'}]}, {id: 'CURRENCY', values: [{id: 'USD'}, {id: 'JPY'}, {id: 'ZZZ'}]}],
                observation: [{id: 'TIME_PERIOD', values: [{id: date}]}]
            }
        },
        dataSets: [{series: {'0:0:0:0:0': {observations: {0: [1.08]}}, '0:1:0:0:0': {observations: {0: [160.5]}}}}]
    }
}

/**
 * @param {string} date - effective date of table A
 */
function mockNbp(date) {
    nock('https://api.nbp.pl').persist().get(/tables\/A/).reply(200, [{table: 'A', effectiveDate: date, rates: [{code: 'USD', mid: 3.86}, {code: 'EUR', mid: 4.18}]}])
    nock('https://api.nbp.pl').persist().get(/tables\/B/).reply(200, [{table: 'B', effectiveDate: '2025-03-26', rates: [{code: 'AFN', mid: 0.054}]}])
    nock('https://api.nbp.pl').persist().get(/cenyzlota/).reply(200, [{data: date, cena: 387.01}])
}

afterEach(() => {
    PriceProviderBase.disposeAll()
    nock.cleanAll()
})

describe('fixings carry their date and expire', () => {
    test('ecb serves a fixing that is fresh for the requested tick and withholds a stale one', async () => {
        nock('https://data-api.ecb.europa.eu').persist().get(() => true).reply(200, ecbPayload(fixingDay))
        const provider = new ECBPriceProvider()
        await provider.cacheLoaded
        const fresh = await provider.getTradesData(tickAt(3 * day))
        expect(Object.keys(fresh).sort()).toEqual(['EUR', 'JPY'])
        expect(fresh.EUR.volume).toBeGreaterThan(0n)
        expect(await provider.getTradesData(tickAt(5 * day + 60 * 1000))).toEqual({})
        provider.dispose()
    })

    test('a missing ecb series is skipped instead of aborting the load', async () => {
        nock('https://data-api.ecb.europa.eu').persist().get(() => true).reply(200, ecbPayload(fixingDay))
        const provider = new ECBPriceProvider()
        await provider.cacheLoaded
        const prices = await provider.getTradesData(tickAt(day))
        expect(prices.ZZZ).toBeUndefined()
        expect(prices.JPY).toBeDefined()
        provider.dispose()
    })

    test('a Thursday fixing serves through Good Friday and Easter Monday', async () => {
        nock('https://data-api.ecb.europa.eu').persist().get(() => true).reply(200, ecbPayload(fixingDay))
        const provider = new ECBPriceProvider()
        await provider.cacheLoaded
        //the fixture's fixingDay stands in for a Thursday fixing that must survive Good Friday and Easter
        //Monday (both TARGET closures) before the next fixing lands on Tuesday; ticks are hours-after-the
        //midnight anchor rather than literal 2026 calendar dates, since tickAt is relative to fixingDay
        const stillFresh = await provider.getTradesData(tickAt(108 * 60 * 60 * 1000))
        expect(stillFresh.EUR).toBeDefined()
        expect(stillFresh.EUR.volume).toBeGreaterThan(0n)
        expect(await provider.getTradesData(tickAt(132 * 60 * 60 * 1000))).toEqual({})
        provider.dispose()
    })

    test('nbp uses table A as the fixing anchor', async () => {
        mockNbp(fixingDay)
        const provider = new NBPPriceProvider()
        await provider.cacheLoaded
        const fresh = await provider.getTradesData(tickAt(2 * day))
        expect(Object.keys(fresh).sort()).toEqual(['AFN', 'EUR', 'PLN', 'XAU'])
        expect(await provider.getTradesData(tickAt(6 * day))).toEqual({})
        provider.dispose()
    })

    test('exchangerate expires after 26 hours', async () => {
        const updated = Math.floor(fixingDate / 1000)
        nock('https://v6.exchangerate-api.com').persist().get(() => true).reply(200, {result: 'success', time_last_update_unix: updated, conversion_rates: {USD: 1, EUR: 0.92}})
        const provider = new ExchangerateApiProvider('mock')
        await provider.cacheLoaded
        expect(Object.keys(await provider.getTradesData(tickAt(25 * 60 * 60 * 1000)))).toEqual(['USD', 'EUR'])
        expect(await provider.getTradesData(tickAt(27 * 60 * 60 * 1000))).toEqual({})
        provider.dispose()
    })

    test('a failed load leaves the cache empty rather than frozen', async () => {
        nock('https://data-api.ecb.europa.eu').persist().get(() => true).reply(500)
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        const error = jest.spyOn(console, 'error').mockImplementation(() => {})
        const provider = new ECBPriceProvider()
        await provider.cacheLoaded
        expect(await provider.getTradesData(tickAt(0))).toEqual({})
        provider.dispose()
        warn.mockRestore()
        error.mockRestore()
    })

    test('the default maximum age is five days', () => {
        expect(PriceProviderBase.defaultMaxAge).toBe(5 * day)
    })
})
