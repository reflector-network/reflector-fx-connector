const PriceData = require('../models/price-data')
const {priceToBigInt} = PriceData
const {calcCrossPrice, PRICE_SCALE} = require('../utils')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://api.forexrateapi.com/v1'

class ForexRateApiProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super('forexrateapi', apiKey, secret)
    }

    async __getTradeData(timestamp, timeout) {
        if (!this.apiKey) {
            throw new Error('API key is required for forexrateapi')
        }
        const requestUrl = `${baseApiUrl}/latest?api_key=${this.apiKey}&base=USD`
        const response = await PriceProviderBase.makeRequest(requestUrl, {timeout})
        if (!response?.data?.success) {
            throw new Error('Failed to get data from forexrateapi')
        }
        return Object.keys(response.data.rates).reduce((acc, symbol) => {
            const rawPrice = priceToBigInt(response.data.rates[symbol])
            const finalPrice = calcCrossPrice(rawPrice, PRICE_SCALE)
            acc[symbol] = new PriceData({price: finalPrice, source: this.name, ts: timestamp})
            return acc
        }, {})
    }
}

module.exports = ForexRateApiProvider
