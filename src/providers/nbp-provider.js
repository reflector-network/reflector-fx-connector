const PriceData = require('../models/price-data')
const {calcCrossPrice, normalizeTimestamp} = require('../utils')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://api.nbp.pl/api'

//Polish National Bank
class NBPPriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'nbp'

    async __getTradeData(timestamp, timeout) {

        //check cache
        const normalizedTimestamp = normalizeTimestamp(timestamp, 60 * 60)
        const cachedData = this.__tryGetCachedData(normalizedTimestamp, timestamp)
        if (cachedData)
            return cachedData

        const requestUrls = [`${baseApiUrl}/exchangerates/tables/A/?format=json`, `${baseApiUrl}/exchangerates/tables/B/?format=json`, `${baseApiUrl}/cenyzlota?format=json`]
        const requests = requestUrls.map(url => this.__makeRequest(url, {timeout}))
        const responses = await Promise.all(requests)
        const priceData = {}
        for (let i = 0; i < responses.length; i++) {
            const response = responses[i]
            if (!response?.data?.length) {
                throw new Error('Failed to get data from nbp')
            }
            if (i !== 2) { //second request is for gold rate
                const rates = response.data[0].rates
                rates.reduce((acc, cRate) => {
                    acc[cRate.code] = new PriceData({
                        price: cRate.mid,
                        source: this.name,
                        ts: timestamp
                    })
                    return acc
                }, priceData)
            } else {
                const goldRate = response.data[0]
                priceData.XAU = new PriceData({
                    price: goldRate.cena * 31.1034768, //convert to ozt
                    source: this.name,
                    ts: timestamp
                })
            }
        }
        if (!priceData.USD)
            throw new Error('USD rate not found')

        const usdPrice = priceData.USD.price
        delete priceData.USD //remove USD rate
        //convert all rates to USD
        for (const symbol of Object.keys(priceData)) {
            priceData[symbol].price = calcCrossPrice(usdPrice, priceData[symbol].price)
        }
        //add PLN rate
        priceData.PLN = new PriceData({
            price: 0n,
            source: this.name,
            ts: timestamp
        })
        //calc PLN rate
        priceData.PLN.price = calcCrossPrice(10000000n, usdPrice)

        //add to cache, clear old data
        this.__clearCache()
        this.__setCacheData(normalizedTimestamp, priceData)

        return priceData
    }
}

module.exports = NBPPriceProvider