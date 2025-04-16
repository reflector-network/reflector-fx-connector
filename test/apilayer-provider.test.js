/*eslint-disable no-undef */
const ApilayerProvider = require('../src/providers/apilayer-provider')
const {getPriceTest} = require('./test-utils')

const provider = new ApilayerProvider('81a2a29370b340a10a7baf6d8e8d3085')

describe('ApilayerProvider', () => {
    it('get price', async () => {
        await getPriceTest(provider, 'USD', 5)
    })

    //it('get price EUR', async () => {
    //await getPriceTest(provider, 'EUR', 5)
    //})
})