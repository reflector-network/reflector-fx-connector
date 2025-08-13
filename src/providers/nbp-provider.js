const PriceData = require('../models/price-data')
const {calcCrossPrice, PRICE_SCALE} = require('../utils')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://api.nbp.pl/api'

const NBPName = 'nbp'

async function loadData() {
    const requestUrls = [`${baseApiUrl}/exchangerates/tables/A/?format=json`, `${baseApiUrl}/exchangerates/tables/B/?format=json`, `${baseApiUrl}/cenyzlota?format=json`]
    const requests = requestUrls.map(url => PriceProviderBase.makeRequest(url, {timeout: 60 * 1000}))
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
                    source: NBPName,
                    ts: 0
                })
                return acc
            }, priceData)
        } else {
            const goldRate = response.data[0]
            priceData.XAU = new PriceData({
                price: goldRate.cena * 31.1034768, //convert to ozt
                source: NBPName,
                ts: 0
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
        source: NBPName,
        ts: 0
    })
    //calc PLN rate
    priceData.PLN.price = calcCrossPrice(PRICE_SCALE, usdPrice)

    return priceData
}

//Polish National Bank
class NBPPriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(NBPName, apiKey, secret, {loadPriceDataFn: loadData})
    }
}

module.exports = NBPPriceProvider