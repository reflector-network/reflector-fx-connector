const PriceData = require('../models/price-data')
const {calcCrossPrice} = require('../utils')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://api.forexrateapi.com/v1'

class ForexRateApiProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'forexrateapi'

    async __getTradeData(timestamp, timeout) {
        if (!this.apiKey) {
            throw new Error('API key is required for forexrateapi')
        }
        const requestUrl = `${baseApiUrl}/latest?api_key=${this.apiKey}&base=USD`
        const response = await this.__makeRequest(requestUrl, {timeout})
        if (!response?.data?.success) {
            throw new Error('Failed to get data from forexrateapi')
        }
        return Object.keys(response.data.rates).reduce((acc, symbol) => {
            acc[symbol] = new PriceData({
                price: response.data.rates[symbol],
                source: this.name,
                ts: timestamp
            })
            acc[symbol].price = calcCrossPrice(acc[symbol].price, 10000000n)
            return acc
        }, {})
    }
}

module.exports = ForexRateApiProvider