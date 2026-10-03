import { routeAgentRequest } from 'agents'

import { HallOfFameAgent } from './HallOfFameAgent'
import type { Env } from './types'

export { HallOfFameAgent }

async function authorized(request: Request, expectedToken: string): Promise<boolean> {
  const suppliedToken = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!suppliedToken || !expectedToken) return false

  const encoder = new TextEncoder()
  const [suppliedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(suppliedToken)),
    crypto.subtle.digest('SHA-256', encoder.encode(expectedToken)),
  ])
  const supplied = new Uint8Array(suppliedDigest)
  const expected = new Uint8Array(expectedDigest)
  let difference = supplied.length ^ expected.length

  for (let index = 0; index < Math.max(supplied.length, expected.length); index += 1) {
    difference |= (supplied[index] ?? 0) ^ (expected[index] ?? 0)
  }

  return difference === 0
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health' && request.method === 'GET') {
      return Response.json({ ok: true, runtime: 'cloudflare-agents' })
    }

    const expectedPath = `/agents/hall-of-fame-agent/${encodeURIComponent(env.HOF_AGENT_ID)}`
    if (url.pathname !== expectedPath) return new Response('Not found', { status: 404 })
    if (!(await authorized(request, env.HOF_CONTROL_TOKEN))) return new Response('Unauthorized', { status: 401 })

    return (await routeAgentRequest(request, env)) ?? new Response('Not found', { status: 404 })
  },
} satisfies ExportedHandler<Env>
