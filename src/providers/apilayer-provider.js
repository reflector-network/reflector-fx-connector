const PriceData = require('../models/price-data')
const {calcCrossPrice} = require('../utils')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://apilayer.net/api'

const base = 'USD'

class ApiLayerProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'apilayer'

    async __getTradeData(timestamp, timeout) {
        if (!this.apiKey) {
            throw new Error('API key is required for apilayer')
        }
        const requestUrl = `${baseApiUrl}/live?access_key=${this.apiKey}&source=USD&format=1`
        const response = await this.__makeRequest(requestUrl, {timeout})
        if (!response?.data?.success) {
            throw new Error('Failed to get data from apilayer')
        }
        return Object.keys(response.data.quotes).reduce((acc, symbol) => {
            const currentSymbol = symbol.substring(base.length)
            acc[currentSymbol] = new PriceData({
                price: response.data.quotes[symbol],
                source: this.name,
                ts: timestamp
            })
            acc[currentSymbol].price = calcCrossPrice(acc[currentSymbol].price, 10000000n)
            return acc
        }, {})
    }
}

module.exports = ApiLayerProvider