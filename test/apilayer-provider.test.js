/*eslint-disable no-undef */
const ApilayerProvider = require('../src/providers/apilayer-provider')
const {getPriceTest} = require('./test-utils')

//live network test: needs a real key in the environment
const apiKey = process.env.APILAYER_API_KEY
const describeLive = apiKey ? describe : describe.skip

describeLive('ApilayerProvider', () => {
    const provider = new ApilayerProvider(apiKey)

    it('get price', async () => {
        await getPriceTest(provider, 'EUR', 5)
    })
})
