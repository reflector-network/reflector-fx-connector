/*eslint-disable no-undef */
const NBPPriceProvider = require('../src/providers/nbp-provider')
const {getPriceTest} = require('./test-utils')

//live network test against api.nbp.pl
describe('NBPPriceProvider', () => {
    const provider = new NBPPriceProvider()

    //stop the cache worker so jest can exit
    afterAll(() => provider.dispose())

    it('get price', async () => {
        await provider.cacheLoaded
        await getPriceTest(provider, 'EUR', 5)
    })
})
