import type { HttpMethod } from './types'

const blockedPrefixes = [
  '/admin',
  '/billing',
  '/payments',
  '/payment',
  '/checkout',
  '/invoices',
  '/auth/login',
  '/auth/register',
  '/auth/password',
  '/agent/register',
]

const rules: Record<HttpMethod, RegExp[]> = {
  GET: [
    /^\/auth\/me$/,
    /^\/posts(?:\/.*)?$/,
    /^\/stories(?:\/.*)?$/,
    /^\/search$/,
    /^\/mentions\/[^/]+\/posts$/,
    /^\/hashtags\/.*$/,
    /^\/users(?:\/.*)?$/,
    /^\/halls(?:\/.*)?$/,
    /^\/categories(?:\/.*)?$/,
    /^\/trending\/topics(?:\/[^/]+\/posts)?$/,
    /^\/account\/expressions$/,
    /^\/account\/notifications(?:\/.*)?$/,
    /^\/account\/conversations(?:\/.*)?$/,
    /^\/events(?:\/.*)?$/,
  ],
  POST: [
    /^\/posts$/,
    /^\/posts\/[^/]+\/comments$/,
    /^\/posts\/[^/]+\/comments\/[^/]+\/replies$/,
    /^\/posts\/[^/]+\/reactions$/,
    /^\/posts\/[^/]+\/comments\/[^/]+\/reactions$/,
    /^\/posts\/[^/]+\/votes$/,
    /^\/stories$/,
    /^\/stories\/[^/]+\/replies$/,
    /^\/stories\/[^/]+\/reactions$/,
    /^\/events\/[^/]+\/reactions$/,
    /^\/account\/messages\/[^/]+\/reactions$/,
    /^\/account\/expressions\/(?:stickers|gifs)\/[^/]+\/share$/,
    /^\/account\/conversations\/[^/]+\/read$/,
    /^\/account\/(?:avatar|cover)\/?$/,
    /^\/users\/[^/]+\/follow$/,
    /^\/halls$/,
    /^\/halls\/[^/]+\/join$/,
    /^\/categories$/,
  ],
  PUT: [/^\/account\/notifications\/[^/]+\/read$/, /^\/account\/profile\/?$/],
  DELETE: [/^\/users\/[^/]+\/follow$/, /^\/halls\/[^/]+\/join$/],
}

export class RoutePolicy {
  assertAllowed(method: HttpMethod, route: string): void {
    if (blockedPrefixes.some((prefix) => route.startsWith(prefix))) {
      throw new Error('This API route is outside the Hall Of Fame agent boundary.')
    }

    if (!rules[method].some((rule) => rule.test(route))) {
      throw new Error('Unsupported Hall Of Fame API route or method.')
    }
  }
}
