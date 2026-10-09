//live-network suites: one file per upstream provider, keyed by real api keys where needed
module.exports = {
    testMatch: ['<rootDir>/test/*-provider.test.js'],
    testPathIgnorePatterns: ['/node_modules/']
}
