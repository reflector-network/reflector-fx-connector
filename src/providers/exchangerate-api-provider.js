const PriceData = require('../models/price-data')
const {priceToBigInt} = PriceData
const {calcCrossPrice, PRICE_SCALE} = require('../utils')
const PriceProviderBase = require('./price-provider-base')

const EXCHANGERATE_NAME = 'exchangerate'

async function loadData(apiKey) {
    if (!apiKey) {
        throw new Error('API key is required for exchangerate')
    }

    const requestUrl = `${baseApiUrl}/${apiKey}/latest/USD`
    const response = await PriceProviderBase.makeRequest(requestUrl, {timeout: 10000})
    if (response?.data?.result !== 'success') {
        throw new Error('Failed to get data from exchangerate')
    }
    const data = Object.keys(response.data.conversion_rates).reduce((acc, symbol) => {
        const rawPrice = priceToBigInt(response.data.conversion_rates[symbol])
        const finalPrice = calcCrossPrice(rawPrice, PRICE_SCALE)
        acc[symbol] = new PriceData({price: finalPrice, source: EXCHANGERATE_NAME, ts: 0})
        return acc
    }, {})

    return data
}

const baseApiUrl = 'https://v6.exchangerate-api.com/v6/'

class ExchangerateApiProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(EXCHANGERATE_NAME, apiKey, secret, {loadPriceDataFn: loadData, interval: 60 * 5 * 1000})
    }
}

module.exports = ExchangerateApiProvider
