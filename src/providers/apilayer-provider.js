const PriceData = require('../models/price-data')
const {priceToBigInt} = PriceData
const {calcCrossPrice, PRICE_SCALE} = require('../utils')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://apilayer.net/api'
const base = 'USD'
const APILAYER_NAME = 'apilayer'

class ApiLayerProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(APILAYER_NAME, apiKey, secret)
    }

    async __getTradeData(timestamp, timeout) {
        if (!this.apiKey) {
            throw new Error('API key is required for apilayer')
        }
        const requestUrl = `${baseApiUrl}/live?access_key=${this.apiKey}&source=USD&format=1`
        const response = await PriceProviderBase.makeRequest(requestUrl, {timeout})
        if (!response?.data?.success) {
            throw new Error('Failed to get data from apilayer')
        }
        return Object.keys(response.data.quotes).reduce((acc, symbol) => {
            const currentSymbol = symbol.substring(base.length)
            const rawPrice = priceToBigInt(response.data.quotes[symbol])
            const finalPrice = calcCrossPrice(rawPrice, PRICE_SCALE)
            acc[currentSymbol] = new PriceData({price: finalPrice, source: this.name, ts: timestamp})
            return acc
        }, {})
    }
}

module.exports = ApiLayerProvider
