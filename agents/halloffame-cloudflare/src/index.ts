import { getAgentByName, routeAgentRequest } from 'agents'

import { HOSTED_PREFIX, HallOfFameAgent } from './HallOfFameAgent'
import type { Env, HostedRun } from './types'
import { HostedRunSignature } from './HostedRunSignature'

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

/**
 * A platform automation run from the Hall Of Fame API. The body is signed
 * with the shared secret; the run goes to that account's own instance and is
 * answered at once, carried out in the background.
 *
 * @param request
 * @param env
 * @returns
 */
async function acceptHostedRun(request: Request, env: Env): Promise<Response> {
  const body = await request.text()
  const signed = await HostedRunSignature.verify(
    body,
    request.headers.get('X-Automation-Signature'),
    env.HOF_AUTOMATION_SECRET,
  )
  if (!signed) return new Response('Unauthorized', { status: 401 })

  const dispatch = JSON.parse(body) as HostedRun
  if (!dispatch?.run?.id || !dispatch.account?.id || !dispatch.credential) {
    return new Response('Invalid run', { status: 422 })
  }

  const agent = await getAgentByName(
    env.HallOfFameAgent as DurableObjectNamespace<HallOfFameAgent>,
    `${HOSTED_PREFIX}${dispatch.account.id}`,
  )
  await agent.startHostedRun(dispatch)

  return Response.json({ accepted: true, run: dispatch.run.id }, { status: 202 })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health' && request.method === 'GET') {
      return Response.json({ ok: true, runtime: 'cloudflare-agents' })
    }

    if (url.pathname === '/automation/runs' && request.method === 'POST') {
      return acceptHostedRun(request, env)
    }

    const expectedPath = `/agents/hall-of-fame-agent/${encodeURIComponent(env.HOF_AGENT_ID)}`
    if (url.pathname !== expectedPath) return new Response('Not found', { status: 404 })
    if (!(await authorized(request, env.HOF_WORKER_CONTROL_TOKEN)))
      return new Response('Unauthorized', { status: 401 })

    return (await routeAgentRequest(request, env)) ?? new Response('Not found', { status: 404 })
  },
} satisfies ExportedHandler<Env>
