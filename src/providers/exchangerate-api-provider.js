const PriceData = require('../models/price-data')
const {calcCrossPrice, normalizeTimestamp} = require('../utils')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://v6.exchangerate-api.com/v6/'
class ExchangerateApiProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'exchangerate'

    async __getTradeData(timestamp, timeout) {
        if (!this.apiKey) {
            throw new Error('API key is required for exchangerate')
        }
        //check cache
        const normalizedTimestamp = normalizeTimestamp(timestamp, 5 * 60)
        const cachedData = this.__tryGetCachedData(normalizedTimestamp, timestamp)
        if (cachedData)
            return cachedData

        const requestUrl = `${baseApiUrl}/${this.apiKey}/latest/USD`
        const response = await this.__makeRequest(requestUrl, {timeout})
        if (response?.data?.result !== 'success') {
            throw new Error('Failed to get data from exchangerate')
        }
        const data = Object.keys(response.data.conversion_rates).reduce((acc, symbol) => {
            acc[symbol] = new PriceData({
                price: response.data.conversion_rates[symbol],
                source: this.name,
                ts: timestamp
            })
            acc[symbol].price = calcCrossPrice(acc[symbol].price, 10000000n)
            return acc
        }, {})
        //Rates are updated every 5 minutes, cache the data
        this.__clearCache()
        this.__setCacheData(normalizedTimestamp, data)
        return data
    }
}

module.exports = ExchangerateApiProvider