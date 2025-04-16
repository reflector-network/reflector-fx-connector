/*eslint-disable no-undef */
const ECBPriceProvider = require('../src/providers/ecb-provider')
const {getPriceTest} = require('./test-utils')

const provider = new ECBPriceProvider()

describe('NBPPriceProvider', () => {
    it('get price', async () => {
        await getPriceTest(provider, 'USD', 5)
    })

    //it('get price EUR', async () => {
    //await getPriceTest(provider, 'EUR', 5)
    //})
})