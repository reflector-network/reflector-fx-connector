//no route left: the gateways are configured and none of them is usable, so the request is refused before any transport call
const noRouteCode = 'ERR_NO_GATEWAY'

//axios codes that describe a deterministic client-side failure; everything else at the transport level may succeed on retry
const deterministicCodes = new Set([
    noRouteCode,
    'ERR_BAD_RESPONSE',
    'ERR_BAD_REQUEST',
    'ERR_FR_TOO_MANY_REDIRECTS',
    'ERR_INVALID_URL',
    'ERR_BAD_OPTION',
    'ERR_BAD_OPTION_VALUE',
    'ERR_NOT_SUPPORT',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'CERT_HAS_EXPIRED',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'ERR_TLS_CERT_ALTNAME_INVALID'
])

/**
 * A failed upstream request, stripped of everything that could leak credentials: no url, no headers, no raw axios error.
 */
class RequestError extends Error {
    /**
     * Code carried by a failure raised because the gateways are configured and none of them is usable. Deterministic:
     * retrying cannot produce a route.
     * @type {string}
     */
    static noRouteCode = noRouteCode

    /**
     * @param {string} host - upstream host
     * @param {{status: number, code: string}} details - what axios reported
     */
    constructor(host, {status, code}) {
        super(`Request to ${host} failed: ${status ? `HTTP ${status}` : code || 'transport error'}`)
        this.name = 'RequestError'
        this.host = host
        this.status = status ?? null
        this.code = code ?? null
        this.retryable = RequestError.isRetryable(this.status, this.code)
    }

    /**
     * A 2xx status paired with a failure means the body was truncated or unreadable mid-stream, which is transient;
     * other statuses are deterministic except rate limits and server errors. With no status at all, only a known
     * deterministic axios or TLS code rules out a retry.
     * @param {number} [status] - HTTP status
     * @param {string} [code] - axios or node error code
     * @returns {boolean}
     */
    static isRetryable(status, code) {
        if (status) {
            if (status < 200 || status >= 300)
                return status === 429 || status >= 500 //the status is the failure
            return true //a 2xx that still failed means a truncated or unreadable body: transient
        }
        return !deterministicCodes.has(code) //no response: ERR_BAD_RESPONSE here is the body cap
    }
}

module.exports = RequestError
