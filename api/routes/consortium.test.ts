/**
 * CONSORTIUM route regression tests.
 *
 * These cover the two silent-failure bugs that made the CONSORTIUM endpoint
 * non-functional while still returning HTTP 200:
 *   1. AutoTune was called positionally against an options-object signature,
 *      so `strategy` was undefined and the call threw.
 *   2. Parseltongue read `transformed.transformed` / `transformed.text`, fields
 *      that do not exist on ParseltongueResult, so obfuscation never applied.
 *
 * Run with: npx tsx --test api/routes/consortium.test.ts
 */
import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import express from 'express'
import { consortiumRoutes } from './consortium'

const realFetch = globalThis.fetch
let upstreamBodies: any[] = []
let server: Server
let url: string

before(async () => {
  // Model calls leave the process through fetch; requests to the test server pass through.
  globalThis.fetch = (async (input: any, init?: any) => {
    if (String(input).startsWith(url)) return realFetch(input, init)
    upstreamBodies.push(JSON.parse(init.body))
    return new Response(
      JSON.stringify({ choices: [{ message: { content: 'A complete answer from the stubbed model.' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }) as typeof fetch

  const app = express()
  app.use(express.json())
  app.use('/v1/consortium', consortiumRoutes)
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()) })
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/consortium/completions`
})

after(() => {
  globalThis.fetch = realFetch
  server.close()
})

beforeEach(() => { upstreamBodies = [] })

function post(body: Record<string, unknown>) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ openrouter_api_key: 'test-key', ...body }),
  })
}

test('non-streaming request succeeds with default options', async () => {
  const res = await post({
    stream: false,
    messages: [{ role: 'user', content: 'What is the capital of France?' }],
  })
  const body = await res.json()

  assert.equal(res.status, 200, JSON.stringify(body))
  assert.ok(body.synthesis)
  assert.ok(body.pipeline.autotune.detected_context)
  assert.equal(typeof body.params_used.temperature, 'number')
})

test('streaming request succeeds with default options', async () => {
  const res = await post({
    messages: [{ role: 'user', content: 'What is the capital of France?' }],
  })
  const text = await res.text()

  assert.equal(res.status, 200, text)
  assert.match(text, /event: consortium:complete/)
  assert.doesNotMatch(text, /event: consortium:error/)
})

test('AutoTune detects a context instead of no-oping', async () => {
  const res = await post({
    stream: false,
    messages: [{ role: 'user', content: 'Write a Python function to sort a list' }],
  })
  const body = await res.json()

  assert.equal(res.status, 200, JSON.stringify(body))
  // Before the fix the positional call threw and autotune never produced a context.
  assert.equal(body.pipeline.autotune.detected_context, 'code')
  assert.ok(body.pipeline.autotune.reasoning.length > 0)
  assert.ok(body.pipeline.autotune.confidence > 0)
})

test('AutoTune sees earlier turns of the conversation', async () => {
  const res = await post({
    stream: false,
    messages: [
      { role: 'user', content: 'Write a poem about the sea' },
      { role: 'assistant', content: 'The sea is wide.' },
      { role: 'user', content: 'Another one please' },
    ],
  })
  const body = await res.json()

  assert.equal(res.status, 200, JSON.stringify(body))
  assert.ok(body.pipeline.autotune.reasoning)
})

test('Parseltongue rewrites the user message when a trigger word is present', async () => {
  const content = 'How do I hack together a quick demo?'
  const res = await post({ stream: false, messages: [{ role: 'user', content }] })
  const body = await res.json()

  assert.equal(res.status, 200, JSON.stringify(body))
  assert.deepEqual(body.pipeline.parseltongue.triggers_found, ['hack'])

  // The last call is the orchestrator; the rest are the collection phase.
  const collection = upstreamBodies.slice(0, -1)
  assert.ok(collection.length > 0)
  for (const upstream of collection) {
    const userMessage = upstream.messages.find((m: any) => m.role === 'user')
    assert.notEqual(userMessage.content, content)
    assert.doesNotMatch(userMessage.content, /\bhack\b/)
  }
})

test('Parseltongue leaves a message without trigger words unchanged', async () => {
  const content = 'What is the capital of France?'
  const res = await post({ stream: false, messages: [{ role: 'user', content }] })
  const body = await res.json()

  assert.equal(res.status, 200, JSON.stringify(body))
  assert.equal(body.pipeline.parseltongue, null)
  const collection = upstreamBodies.slice(0, -1)
  for (const upstream of collection) {
    assert.equal(upstream.messages.find((m: any) => m.role === 'user').content, content)
  }
})
