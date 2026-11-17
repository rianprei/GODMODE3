/**
 * Cost-aware escalation tests for raceModels().
 *
 * The legacy race launched every model within ~600ms. Early-stop saved latency
 * but not cost: all models were already billed. With escalationBatchSize > 1,
 * batches are launched only while no result clears the quality threshold.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { raceModels } from './ultraplinian'

const models = Array.from({ length: 59 }, (_, i) => `provider/model-${String(i).padStart(2, '0')}`)

test('batch escalation bills far fewer models on an easy query', async () => {
  let launched = 0
  const originalFetch = globalThis.fetch

  // Stub OpenRouter: every model returns a strong, structured response.
  globalThis.fetch = (async (_input: any, init: any) => {
    launched++
    const body = JSON.parse(init.body)
    const model = body.model
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: [
            `# Result for ${model}`,
            '',
            '- A concrete first point with enough length to score highly',
            '- A second concrete point with specifics and numbers (42 units)',
            '- A third point with a code example `example()` and details',
            '',
            'Here is the direct answer to the query with all relevant keywords.',
          ].join('\n'),
        },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch

  try {
    const results = await raceModels(
      models,
      [{ role: 'user', content: 'explain implementation with details' }],
      'test-key',
      { temperature: 0.7, max_tokens: 100 },
      { minResults: 5, gracePeriod: 50, hardTimeout: 5000, escalationBatchSize: 5, escalationThreshold: 75 },
    )

    assert.ok(results.length > 0, 'at least one result')
    assert.ok(launched <= 10, `expected <=10 billed models, got ${launched}`)
    const fullCost = models.length
    const saving = Math.round((1 - launched / fullCost) * 100)
    assert.ok(saving >= 80, `expected >=80% cost saving, got ${saving}%`)
    console.log(`    billed ${launched}/${fullCost} (${saving}% cheaper)`)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('batchSize=1 keeps the legacy full-parallel behavior', async () => {
  let launched = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (_input: any, init: any) => {
    launched++
    const body = JSON.parse(init.body)
    return new Response(JSON.stringify({
      choices: [{ message: { content: `# ${body.model}\n- item one\n- item two\n- item three\n\nDirect answer with keywords.` } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch

  try {
    const results = await raceModels(
      models,
      [{ role: 'user', content: 'explain implementation with details' }],
      'test-key',
      { temperature: 0.7, max_tokens: 100 },
      { minResults: 5, gracePeriod: 2000, hardTimeout: 5000, escalationBatchSize: 1 },
    )
    assert.ok(results.length > 0)
    assert.equal(launched, models.length, 'legacy mode still launches every model')
  } finally {
    globalThis.fetch = originalFetch
  }
})
