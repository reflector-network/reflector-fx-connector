const PriceData = require('../models/price-data')
const {priceToBigInt} = PriceData
const {calcCrossPrice, PRICE_SCALE} = require('../utils')
const PriceProviderBase = require('./price-provider-base')

function getStartPeriod() {
    const startPeriod = new Date()
    startPeriod.setDate(new Date().getDate() - 14)
    return startPeriod.toISOString().split('T')[0] //current date - 14 days
}

const ECB_NAME = 'ecb'

async function loadData() {
    const url = `https://data-api.ecb.europa.eu/service/data/EXR/D..EUR.SP00.A?format=jsondata&detail=dataonly&lastNObservations=1&includeHistory=false&startPeriod=${getStartPeriod()}`
    const response = await PriceProviderBase.makeRequest(url, {timeout: 60 * 1000}) //1 minute timeout
    if (!response)
        throw new Error('Failed to get data from ecb')
    const {data} = response
    const currencies = data?.structure?.dimensions?.series?.find(s => s.id === 'CURRENCY')?.values
    if (!currencies)
        throw new Error('Failed to get data from ecb')
    const prices = data?.dataSets?.[0]?.series
    if (!prices)
        throw new Error('Failed to get data from ecb')

    //first pass: collect raw BigInt rates (currency-per-EUR scaled to 14 dec)
    const rawRates = {}
    for (let i = 0; i < currencies.length; i++) {
        const currency = currencies[i]
        const observations = prices[`0:${i}:0:0:0`]?.observations
        const observKey = Object.keys(observations)?.[0]
        rawRates[currency.id] = priceToBigInt(observations[observKey]?.[0] ?? 0)
    }
    if (!rawRates.USD)
        throw new Error('USD rate not found')

    const usdPrice = rawRates.USD
    delete rawRates.USD

    //second pass: convert each rate to USD via cross-price; add EUR
    const finalRates = {}
    for (const symbol of Object.keys(rawRates)) {
        finalRates[symbol] = rawRates[symbol] ? calcCrossPrice(rawRates[symbol], usdPrice) : 0n
    }
    finalRates.EUR = calcCrossPrice(PRICE_SCALE, usdPrice)

    //third pass: construct PriceData once per symbol
    const priceData = {}
    for (const [symbol, price] of Object.entries(finalRates)) {
        priceData[symbol] = new PriceData({price, source: ECB_NAME, ts: 0})
    }
    return priceData
}


//Europe Central Bank
class ECBPriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(ECB_NAME, apiKey, secret, {loadPriceDataFn: loadData})
    }
}

module.exports = ECBPriceProvider
