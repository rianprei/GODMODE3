/**
 * Boot regression tests for both API servers.
 *
 * Both trees failed to start before these fixes:
 *   - root  api/: `researchRoutes.get('/batch/*')` — a bare `*` is invalid under
 *     path-to-regexp v8 (Express 5), so route registration threw and the process
 *     died before listen().
 *   - HF    api/: `models.ts` read `ULTRAPLINIAN_MODELS.full.length` at module
 *     scope, but the catalogue has no `full` key — the import threw.
 *
 * Run with: npx tsx --test api/server.boot.test.ts
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import express from 'express'

async function bootServer(loader: () => Promise<any>) {
  const mod = await loader()
  // server.ts exports startServer(); it no longer listens on import.
  const server: Server = mod.startServer
    ? mod.startServer(0)
    : (mod.default ?? mod).listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', () => resolve()))
  const port = (server.address() as AddressInfo).port
  return { server, base: `http://127.0.0.1:${port}` }
}

test('root API server boots and answers /v1/health', async () => {
  process.env.GODMODE_API_KEY = 'test-key-123'
  process.env.OPENROUTER_API_KEY = 'sk-or-fake'
  process.env.HF_TOKEN = ''
  process.env.HF_DATASET_REPO = ''

  const { server, base } = await bootServer(() => import('./server'))
  try {
    const res = await fetch(`${base}/v1/health`)
    assert.equal(res.status, 200)
    const body = await res.json() as { status: string }
    assert.equal(body.status, 'ok')
  } finally {
    server.close()
  }
})

test('root API server registers the research batch wildcard route', async () => {
  process.env.GODMODE_API_KEY = 'test-key-123'
  process.env.OPENROUTER_API_KEY = 'sk-or-fake'
  process.env.HF_TOKEN = ''
  process.env.HF_DATASET_REPO = ''
  process.env.GODMODE_TIER_KEYS = 'enterprise:test-key-123'

  const { server, base } = await bootServer(() => import('./server'))
  try {
    // The route exists: it must answer 400/404-from-upstream, never a 404 "route not found".
    const res = await fetch(`${base}/v1/research/batch/metadata/batch_2024-01-01_0001.jsonl`, {
      headers: { Authorization: 'Bearer test-key-123' },
    })
    assert.notEqual(res.status, 404)
  } finally {
    server.close()
  }
})

test('HF API server boots (models.ts no longer throws on .full)', async () => {
  process.env.GODMODE_API_KEY = 'test-key-123'
  process.env.OPENROUTER_API_KEY = 'sk-or-fake'
  process.env.HF_TOKEN = ''
  process.env.HF_DATASET_REPO = ''

  const { server, base } = await bootServer(() => import('../HF/api/server'))
  try {
    const res = await fetch(`${base}/v1/health`)
    assert.equal(res.status, 200)
  } finally {
    server.close()
  }
})

test('HF /v1/models lists ultraplinian-full with the real model count', async () => {
  process.env.GODMODE_API_KEY = 'test-key-123'
  process.env.OPENROUTER_API_KEY = 'sk-or-fake'
  process.env.HF_TOKEN = ''
  process.env.HF_DATASET_REPO = ''

  const { ULTRAPLINIAN_MODELS } = await import('../HF/api/lib/ultraplinian')
  const { server, base } = await bootServer(() => import('../HF/api/server'))
  try {
    const res = await fetch(`${base}/v1/models`, {
      headers: { Authorization: 'Bearer test-key-123' },
    })
    assert.equal(res.status, 200)
    const { data } = await res.json() as { data: Array<{ id: string; model_count?: number; description?: string }> }
    const full = data.find(m => m.id === 'ultraplinian-full')
    assert.ok(full, 'ultraplinian-full must be listed')
    const total = Object.values(ULTRAPLINIAN_MODELS).flat().length
    assert.equal(full.model_count, total)
    assert.match(full.description ?? '', new RegExp(`Race all ${total} models`))
  } finally {
    server.close()
  }
})
