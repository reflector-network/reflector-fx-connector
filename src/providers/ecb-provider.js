const PriceData = require('../models/price-data')
const {calcCrossPrice, normalizeTimestamp} = require('../utils')
const PriceProviderBase = require('./price-provider-base')

function getStartPeriod() {
    const startPeriod = new Date()
    startPeriod.setDate(new Date().getDate() - 14)
    return startPeriod.toISOString().split('T')[0] //current date - 14 days
}

//Europe Central Bank
class ECBPriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'ecb'

    async __getTradeData(timestamp, timeout) {

        //check cache
        const normalizedTimestamp = normalizeTimestamp(timestamp, 60 * 60)
        const cachedData = this.__tryGetCachedData(normalizedTimestamp, timestamp)
        if (cachedData)
            return cachedData

        const url = `https://data-api.ecb.europa.eu/service/data/EXR/D..EUR.SP00.A?format=jsondata&detail=dataonly&lastNObservations=1&includeHistory=false&startPeriod=${getStartPeriod()}`
        const response = await this.__makeRequest(url, {timeout})
        if (!response)
            throw new Error('Failed to get data from ecb')
        const {data} = response
        const currencies = data?.structure?.dimensions?.series?.find(s => s.id === 'CURRENCY')?.values
        if (!currencies)
            throw new Error('Failed to get data from ecb')
        const prices = data?.dataSets?.[0]?.series
        if (!prices)
            throw new Error('Failed to get data from ecb')
        const priceData = {}
        for (let i = 0; i < currencies.length; i++) {
            const currency = currencies[i]
            priceData[currency.id] = new PriceData({
                price: prices[`0:${i}:0:0:0`]?.observations[0]?.[0] ?? 0,
                source: this.name,
                ts: timestamp
            })
        }
        if (!priceData.USD)
            throw new Error('USD rate not found')

        const usdPrice = priceData.USD.price
        delete priceData.USD //remove USD rate
        //convert all rates to USD
        for (const symbol of Object.keys(priceData)) {
            priceData[symbol].price = calcCrossPrice(priceData[symbol].price, usdPrice)
        }
        //add EUR rate
        priceData.EUR = new PriceData({
            price: calcCrossPrice(10000000n, usdPrice),
            source: this.name,
            ts: timestamp
        })
        //add to cache, clear old data
        this.__clearCache()
        this.__setCacheData(normalizedTimestamp, priceData)
        return priceData
    }
}

module.exports = ECBPriceProvider