const PriceData = require('../models/price-data')
const {calcCrossPrice} = require('../utils')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://exchange-rates.abstractapi.com/v1'

class AbstractApiProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'abstractapi'

    async __getTradeData(timestamp, timeout) {
        if (!this.apiKey) {
            throw new Error('API key is required for abstractapi')
        }
        const requestUrl = `${baseApiUrl}/live/?api_key=${this.apiKey}&base=USD`
        const response = await this.__makeRequest(requestUrl, {timeout})
        if (!response) {
            throw new Error('Failed to get data from abstractapi')
        }
        return Object.keys(response.data.exchange_rates).reduce((acc, symbol) => {
            acc[symbol] = new PriceData({
                price: response.data.exchange_rates[symbol],
                source: this.name,
                ts: timestamp
            })
            acc[symbol].price = calcCrossPrice(acc[symbol].price, 10000000n)
            return acc
        }, {})
    }
}

module.exports = AbstractApiProvider