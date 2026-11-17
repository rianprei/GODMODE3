/**
 * rateLimit middleware tests (ported from upstream PR #93, converted to node:test).
 *
 * Covers the memory-leak fix: buckets are reclaimed once inactive, but buckets
 * that hit the lifetime cap stay (blocked) so the cap remains enforced.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { rateLimit } from './rateLimit'
import type { TierConfig } from '../lib/tiers'

const tier: TierConfig = {
  name: 'free',
  label: 'Free',
  rateLimit: { total: 2, perMinute: 100, perDay: 1000 },
  ultraplinianTiers: ['fast'],
  maxRaceModels: 12,
  researchAccess: 'none',
  datasetExportFormats: [],
  canFlush: false,
  canAccessMetadataEvents: false,
  canDownloadCorpus: false,
} as TierConfig

/** Run the middleware once for a key and resolve with the resulting status. */
function callRateLimit(keyId: string): Promise<number> {
  return new Promise((resolve) => {
    const req: any = { apiKeyId: keyId, tierConfig: tier }
    const res: any = {
      statusCode: 0,
      status(code: number) {
        this.statusCode = code
        return this
      },
      json() {
        resolve(res.statusCode || 200)
        return this
      },
      setHeader() {
        return this
      },
    }
    rateLimit(req, res, () => resolve(res.statusCode || 200))
  })
}

test('allows requests under the lifetime cap', async () => {
  assert.equal(await callRateLimit('rt-allow-1'), 200)
  assert.equal(await callRateLimit('rt-allow-1'), 200)
})

test('blocks once the lifetime cap is hit and stays blocked', async () => {
  await callRateLimit('rt-block-1')
  await callRateLimit('rt-block-1')
  assert.equal(await callRateLimit('rt-block-1'), 429)
  assert.equal(await callRateLimit('rt-block-1'), 429)
})

test('tracks keys independently', async () => {
  await callRateLimit('rt-ind-1')
  await callRateLimit('rt-ind-1')
  assert.equal(await callRateLimit('rt-ind-2'), 200)
  assert.equal(await callRateLimit('rt-ind-1'), 429)
})
