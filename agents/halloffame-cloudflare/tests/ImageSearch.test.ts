import { describe, expect, it } from 'vitest'

import { ImageSearch } from '../src/ImageSearch'

/** A fetch that answers each source with a fixed body and records what was asked. */
function fakeFetch(bodies: Record<string, unknown>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    const key = Object.keys(bodies).find((prefix) => url.startsWith(prefix))

    return Response.json(key ? bodies[key] : {})
  }) as typeof fetch

  return { calls, fetcher }
}

describe('ImageSearch', () => {
  it('offers keyed sources only when configured', () => {
    expect(new ImageSearch({ userAgent: 'test' }).sources()).toEqual(['openverse', 'wikimedia'])
    expect(
      new ImageSearch({ userAgent: 'test', unsplashKey: 'u', pexelsKey: 'p' }).sources(),
    ).toEqual(['openverse', 'wikimedia', 'unsplash', 'pexels'])
  })

  it('searches Openverse for commercial licences and credits all but the public domain', async () => {
    const { calls, fetcher } = fakeFetch({
      'https://api.openverse.org': {
        results: [
          {
            title: 'Server room',
            url: 'https://live.staticflickr.com/a.jpg',
            creator: 'Ada',
            license: 'by',
            license_version: '2.0',
            foreign_landing_url: 'https://flickr.com/a',
            width: 1024,
            height: 768,
          },
          { title: 'Free', url: 'https://example.org/b.jpg', creator: 'Bo', license: 'cc0' },
        ],
      },
    })

    const images = await new ImageSearch({ userAgent: 'test', fetcher }).find('fast technology')

    expect(calls[0]!.url).toContain('license_type=commercial')
    expect(images).toEqual([
      expect.objectContaining({
        source: 'openverse',
        url: 'https://live.staticflickr.com/a.jpg',
        license: 'CC BY 2.0',
        credit: 'Photo: Ada, CC BY 2.0 via Openverse',
      }),
      expect.objectContaining({ license: 'CC0', credit: null }),
    ])
  })

  it('searches Wikimedia Commons with a user agent and keeps only uploadable images', async () => {
    const { calls, fetcher } = fakeFetch({
      'https://commons.wikimedia.org': {
        query: {
          pages: [
            {
              title: 'File:Accra skyline.jpg',
              imageinfo: [
                {
                  mime: 'image/jpeg',
                  thumburl: 'https://upload.wikimedia.org/thumb/accra.jpg',
                  descriptionurl: 'https://commons.wikimedia.org/wiki/File:Accra_skyline.jpg',
                  extmetadata: {
                    Artist: { value: '<a href="/wiki/User:Kofi">Kofi</a>' },
                    LicenseShortName: { value: 'CC BY-SA 4.0' },
                    AttributionRequired: { value: 'true' },
                  },
                },
              ],
            },
            { title: 'File:Map.svg', imageinfo: [{ mime: 'image/svg+xml' }] },
          ],
        },
      },
    })

    const images = await new ImageSearch({ userAgent: 'agent/1.0', fetcher }).find(
      'Accra',
      'wikimedia',
    )

    expect(calls[0]!.headers['User-Agent']).toBe('agent/1.0')
    expect(images).toEqual([
      expect.objectContaining({
        source: 'wikimedia',
        url: 'https://upload.wikimedia.org/thumb/accra.jpg',
        title: 'Accra skyline.jpg',
        creator: 'Kofi',
        credit: 'Photo: Kofi, CC BY-SA 4.0 via Wikimedia Commons',
      }),
    ])
  })

  it('reports an Unsplash photo once it is used', async () => {
    const { calls, fetcher } = fakeFetch({
      'https://api.unsplash.com/search': {
        results: [
          {
            urls: { regular: 'https://images.unsplash.com/photo-1' },
            links: {
              html: 'https://unsplash.com/photos/1',
              download_location: 'https://api.unsplash.com/photos/1/download',
            },
            user: { name: 'Ama' },
          },
        ],
      },
    })
    const search = new ImageSearch({ userAgent: 'test', unsplashKey: 'key', fetcher })

    const [image] = await search.find('robots', 'unsplash')
    expect(image).toMatchObject({ credit: 'Photo by Ama on Unsplash' })

    await search.used('https://images.unsplash.com/photo-1')
    expect(calls.at(-1)).toMatchObject({
      url: 'https://api.unsplash.com/photos/1/download',
      headers: { Authorization: 'Client-ID key' },
    })
  })

  it('falls back to Openverse for a source that is not configured', async () => {
    const { calls, fetcher } = fakeFetch({ 'https://api.openverse.org': { results: [] } })

    await new ImageSearch({ userAgent: 'test', fetcher }).find('cars', 'pexels')

    expect(calls[0]!.url).toContain('api.openverse.org')
  })

  describe('Openverse credentials', () => {
    const openverse = { clientId: 'id', clientSecret: 'secret' }

    /** Openverse with a token endpoint; `searchStatus` answers each search in turn. */
    function openverseFetch(tokenOk = true, searchStatus: number[] = []) {
      const calls: Array<{
        url: string
        method: string
        headers: Record<string, string>
        body?: string
      }> = []
      let tokens = 0
      const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        calls.push({
          url,
          method: init?.method ?? 'GET',
          headers: (init?.headers ?? {}) as Record<string, string>,
          body: typeof init?.body === 'string' ? init.body : undefined,
        })
        if (url.endsWith('/auth_tokens/token/')) {
          tokens += 1

          return tokenOk
            ? Response.json({ access_token: `token-${tokens}`, expires_in: 36000 })
            : Response.json({ detail: 'invalid_client' }, { status: 401 })
        }

        return Response.json({ results: [] }, { status: searchStatus.shift() ?? 200 })
      }) as typeof fetch

      return { calls, fetcher }
    }

    it('exchanges the credentials once and sends the token on every search', async () => {
      const { calls, fetcher } = openverseFetch()
      const search = new ImageSearch({ userAgent: 'test', openverse, fetcher })

      await search.find('robots')
      await search.find('cars')

      const tokenCalls = calls.filter((call) => call.url.endsWith('/auth_tokens/token/'))
      expect(tokenCalls).toHaveLength(1)
      expect(tokenCalls[0]).toMatchObject({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials&client_id=id&client_secret=secret',
      })
      const searches = calls.filter((call) => call.url.includes('/images/'))
      expect(searches.map((call) => call.headers.Authorization)).toEqual([
        'Bearer token-1',
        'Bearer token-1',
      ])
    })

    it('renews a token Openverse rejects', async () => {
      const { calls, fetcher } = openverseFetch(true, [401])

      await new ImageSearch({ userAgent: 'test', openverse, fetcher }).find('robots')

      const searches = calls.filter((call) => call.url.includes('/images/'))
      expect(searches.map((call) => call.headers.Authorization)).toEqual([
        'Bearer token-1',
        'Bearer token-2',
      ])
    })

    it('searches anonymously when the credentials do not work', async () => {
      const { calls, fetcher } = openverseFetch(false)

      await new ImageSearch({ userAgent: 'test', openverse, fetcher }).find('robots')

      const search = calls.find((call) => call.url.includes('/images/'))
      expect(search?.headers.Authorization).toBeUndefined()
    })
  })
})
