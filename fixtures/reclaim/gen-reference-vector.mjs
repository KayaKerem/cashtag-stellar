// Usage: npm i ethers@6 canonicalize@2 && node fixtures/reclaim/gen-reference-vector.mjs > fixtures/reclaim/reference-vector.json
// Deterministic (RFC 6979). Test-only keys; never use them for anything real.
// Mirrors attestor-core src/utils/claims.ts + src/utils/signatures/eth.ts exactly.
import canonicalize from 'canonicalize'
import { keccak256, toUtf8Bytes, Wallet, SigningKey, computeAddress, Signature } from 'ethers'
const canonicalStringify = (p) => p ? (canonicalize(p) || '') : ''
function hashProviderParams(params) {
  const f = { url: params.url, method: params.method, body: params.body ?? '',
    responseMatches: params.responseMatches.map(it => ({ value: it.value, type: it.type, invert: it.invert || undefined })),
    responseRedactions: params.responseRedactions?.map(it => ({ xPath: it.xPath ?? '', jsonPath: it.jsonPath ?? '', regex: it.regex ?? '', hash: it.hash || undefined })) ?? [] }
  return keccak256(toUtf8Bytes(canonicalStringify(f))).toLowerCase()
}
const getIdentifierFromClaimInfo = (info) => keccak256(toUtf8Bytes(`${info.provider}\n${info.parameters}\n${info.context || ''}`)).toLowerCase()
const createSignDataForClaim = (d) => [getIdentifierFromClaimInfo(d), d.owner.toLowerCase(), d.timestampS.toString(), d.epoch.toString()].join('\n')
const PREFIX = toUtf8Bytes('\x19Ethereum Signed Message:\n')
function eip191Digest(data) { const b = toUtf8Bytes(data); const l = toUtf8Bytes(String(b.length)); const m = new Uint8Array(PREFIX.length + l.length + b.length); m.set(PREFIX,0); m.set(l,PREFIX.length); m.set(b,PREFIX.length+l.length); return keccak256(m) }

// zkFetch-shaped params (zk-fetch/src/zkfetch.ts): method, url, responseMatches, headers(undefined), geoLocation(undefined), responseRedactions, body "", paramValues(undefined)
const url = 'https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=dQw4w9WgXcQ'
const params = {
  method: 'GET', url,
  responseMatches: [
    { type: 'regex', value: '"viewCount":\\s*"(?<views>\\d+)"' },
    { type: 'regex', value: '"description":\\s*"(?<desc>(?:[^"\\\\]|\\\\.)*)"' },
  ],
  headers: undefined, geoLocation: undefined, responseRedactions: [], body: '', paramValues: undefined,
}
// Raw capture of the description group as it appears in the (JSON) HTTP body: escapes are still literal.
const descRaw = String.raw`Official video. Join the campaign: CR-7F3K9Q\nLinks: https://example.com/?a=1&b=2 \"quoted\" \\ backslash é 🎉 fake \"viewCount\":\"999\" and \"views\":\"888\"`
const viewsRaw = '1234567'
const parameters = canonicalStringify(params)
const ctx = { contextAddress: '0x0', contextMessage: 'cliprail:c1:e1' }
ctx.providerHash = hashProviderParams(params)
ctx.extractedParameters = { views: viewsRaw, desc: descRaw }
const context = canonicalStringify(ctx)
const pk = keccak256(toUtf8Bytes('cliprail-test-attestor'))
const ownerPk = keccak256(toUtf8Bytes('cliprail-test-owner'))
const owner = computeAddress(new SigningKey(ownerPk).publicKey).toLowerCase()
const claim = { provider: 'http', parameters, context, owner, timestampS: 1758240000, epoch: 1 }
const identifier = getIdentifierFromClaimInfo(claim)
const signData = createSignDataForClaim(claim)
const digest = eip191Digest(signData)
const w = new Wallet(pk)
const sig = w.signingKey.sign(digest)
const sigBytes = sig.serialized // 0x r s v
const viaSignMessage = await w.signMessage(toUtf8Bytes(signData))
console.log(JSON.stringify({ attestorSecret: pk, attestorAddress: w.address.toLowerCase(), owner, ownerSecret: ownerPk, timestampS: claim.timestampS, epoch: 1, parameters, context, identifier, signData, digest, signature: sigBytes, sameAsSignMessage: viaSignMessage === sigBytes }, null, 2))
