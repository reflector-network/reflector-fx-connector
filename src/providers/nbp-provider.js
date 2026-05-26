const PriceData = require('../models/price-data')
const {priceToBigInt} = PriceData
const {calcCrossPrice, PRICE_SCALE} = require('../utils')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://api.nbp.pl/api'

const NBPName = 'nbp'

async function loadData() {
    const requestUrls = [`${baseApiUrl}/exchangerates/tables/A/?format=json`, `${baseApiUrl}/exchangerates/tables/B/?format=json`, `${baseApiUrl}/cenyzlota?format=json`]
    const requests = requestUrls.map(url => PriceProviderBase.makeRequest(url, {timeout: 60 * 1000}))
    const responses = await Promise.all(requests)

    //first pass: collect raw BigInt rates (PLN-per-currency scaled to 14 dec)
    const rawRates = {}
    for (let i = 0; i < responses.length; i++) {
        const response = responses[i]
        if (!response?.data?.length) {
            throw new Error('Failed to get data from nbp')
        }
        if (i !== 2) { //third request is the gold price
            const rates = response.data[0].rates
            for (const cRate of rates) {
                rawRates[cRate.code] = priceToBigInt(cRate.mid)
            }
        } else {
            //gold rate: NBP returns PLN per gram; multiply by 31.1034768 g/ozt to get PLN per troy ounce
            const goldRate = response.data[0]
            rawRates.XAU = priceToBigInt(goldRate.cena * 31.1034768)
        }
    }
    if (!rawRates.USD)
        throw new Error('USD rate not found')

    const usdPrice = rawRates.USD
    delete rawRates.USD

    //second pass: convert each rate to USD via cross-price; add PLN
    const finalRates = {}
    for (const symbol of Object.keys(rawRates)) {
        finalRates[symbol] = calcCrossPrice(usdPrice, rawRates[symbol])
    }
    //usdPrice is PLN-per-USD here (NBP convention); to express 1 PLN in USD,
    //divide PRICE_SCALE by usdPrice — i.e., calcCrossPrice with args in this order
    finalRates.PLN = calcCrossPrice(usdPrice, PRICE_SCALE)

    //third pass: construct PriceData once per symbol
    const priceData = {}
    for (const [symbol, price] of Object.entries(finalRates)) {
        priceData[symbol] = new PriceData({price, source: NBPName, ts: 0})
    }
    return priceData
}

//Polish National Bank
class NBPPriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(NBPName, apiKey, secret, {loadPriceDataFn: loadData})
    }
}

module.exports = NBPPriceProvider
