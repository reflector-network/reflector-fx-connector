const PriceData = require('../models/price-data')
const {priceToBigInt} = PriceData
const {calcCrossPrice, PRICE_SCALE} = require('../utils')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://exchange-rates.abstractapi.com/v1'

class AbstractApiProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super('abstractapi', apiKey, secret)
    }

    async __getTradeData(timestamp, timeout) {
        if (!this.apiKey) {
            throw new Error('API key is required for abstractapi')
        }
        const requestUrl = `${baseApiUrl}/live/?api_key=${this.apiKey}&base=USD`
        const response = await PriceProviderBase.makeRequest(requestUrl, {timeout})
        if (!response) {
            throw new Error('Failed to get data from abstractapi')
        }
        return Object.keys(response.data.exchange_rates).reduce((acc, symbol) => {
            const rawPrice = priceToBigInt(response.data.exchange_rates[symbol])
            const finalPrice = calcCrossPrice(rawPrice, PRICE_SCALE)
            acc[symbol] = new PriceData({price: finalPrice, source: this.name, ts: timestamp})
            return acc
        }, {})
    }
}

module.exports = AbstractApiProvider
