import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import * as utils from '../src/utils.ts'
let request = async () => {
  throw new Error('Unexpected external request')
}
mock.module('../src/utils.ts', {
  namedExports: { ...utils, http1makeRequest: (...args) => request(...args) }
})
const { default: SoundCloud } = await import('../src/sources/soundcloud.ts')
const { default: YouTube } = await import('../src/sources/youtube/YouTube.ts')
const { default: SourceManager } = await import(
  '../src/managers/sourceManager.ts'
)
const track = {
  identifier: 'chosen',
  sourceName: 'youtube',
  title: 'Chosen',
  author: 'Artist',
  length: 200000
}
function youtube() {
  const y = Object.create(YouTube.prototype)
  Object.assign(y, {
    config: { clients: { playback: ['Web'] }, proxies: [] },
    clients: {},
    failingClientsByTrack: new Map(),
    nodelink: {}
  })
  return y
}
test('strict YouTube blocks cross-source mirror after all clients fail (93103ec)', async () => {
  delete process.env.SBR_ALLOW_YOUTUBE_MIRROR
  const y = youtube()
  y._tryMirrorSourceTrackUrl = async () => {
    throw Error('substitution attempted')
  }
  assert.ok((await y.getTrackUrl(track)).exception)
})
test('strict mode also blocks OLAK search, stale mirrored cache and selected audio fallback', async () => {
  const y = youtube()
  let searches = 0
  y.search = async () => {
    searches++
    throw Error('wrong recording')
  }
  y.nodelink.trackCacheManager = {
    get: () => ({
      url: 'https://media.invalid/bgm',
      newTrack: { info: { identifier: 'other', sourceName: 'soundcloud' } }
    })
  }
  assert.ok(
    (
      await y.getTrackUrl({
        ...track,
        uri: 'https://youtube.com/watch?v=chosen&olak=true'
      })
    ).exception
  )
  assert.ok(
    (await y.getTrackUrl({ ...track, audioTrackId: 'selected-language' }))
      .exception
  )
  assert.equal(searches, 0)
})
test('explicit opt-in preserves legacy mirror behavior', async () => {
  process.env.SBR_ALLOW_YOUTUBE_MIRROR = 'true'
  try {
    const y = youtube()
    y._tryMirrorSourceTrackUrl = async () => ({
      url: 'https://media.invalid/opt-in'
    })
    assert.equal(
      (await y.getTrackUrl(track)).url,
      'https://media.invalid/opt-in'
    )
  } finally {
    delete process.env.SBR_ALLOW_YOUTUBE_MIRROR
  }
})
test('ISRC cannot silently upscale a YouTube selection to another source', async () => {
  const manager = new SourceManager({ options: {}, statsManager: {} })
  manager.sourceMap.set('youtube', {
    getTrackUrl: async (t) => ({ url: 'https://media.invalid/' + t.identifier })
  })
  manager.sources.set('deezer', {
    search() {
      throw Error('ISRC substitution')
    }
  })
  manager.search = async () => {
    throw Error('ISRC search attempted')
  }
  assert.equal(
    (await manager.getTrackUrl({ ...track, isrc: 'TEST123' })).url,
    'https://media.invalid/chosen'
  )
})
function sc() {
  return new SoundCloud({
    options: { sources: { soundcloud: { clientId: 'public-client' } } },
    credentialManager: { get() {} },
    trackCacheManager: { get() {}, set() {} }
  })
}
const transcoding = (
  url,
  protocol = 'progressive',
  mime_type = 'audio/mpeg'
) => ({ url, format: { protocol, mime_type } })
test('SoundCloud falls back from HTTP 403 to HLS of same track and preserves query', async () => {
  const urls = []
  request = async (u) => {
    urls.push(u)
    return urls.length === 1
      ? { statusCode: 403 }
      : {
          statusCode: 200,
          body: { url: 'https://media.invalid/same-track.m3u8' }
        }
  }
  const r = await sc()._selectTranscoding({
    id: 1,
    media: {
      transcodings: [
        transcoding('https://api.invalid/bad?existing=yes'),
        transcoding('https://api.invalid/good', 'hls', 'audio/aac')
      ]
    }
  })
  assert.equal(r.url, 'https://media.invalid/same-track.m3u8')
  assert.equal(r.protocol, 'hls')
  assert.equal(new URL(urls[0]).searchParams.get('existing'), 'yes')
  assert.equal(new URL(urls[0]).searchParams.get('client_id'), 'public-client')
})
test('redirect JSON uses contained media URL rather than redirect API URL', async () => {
  request = async () => ({
    statusCode: 200,
    finalUrl: 'https://api.invalid/redirected',
    body: { url: 'https://media.invalid/audio' }
  })
  assert.equal(
    (
      await sc()._selectTranscoding({
        media: { transcodings: [transcoding('https://api.invalid/auth')] }
      })
    ).url,
    'https://media.invalid/audio'
  )
})
test('HTML/empty success, preview, and HTTP 503 never become playable media', async () => {
  for (const response of [
    { statusCode: 200, body: '<html>Error</html>' },
    {
      statusCode: 200,
      body: { url: 'https://cf-preview-media.sndcdn.com/preview/1' }
    },
    { statusCode: 503 }
  ]) {
    request = async () => response
    assert.ok(
      (
        await sc()._selectTranscoding({
          media: { transcodings: [transcoding('https://api.invalid/auth')] }
        })
      ).exception
    )
  }
})
test('recovery argument bypasses SoundCloud cache using manager signature', async () => {
  const s = sc()
  let reads = 0
  let calls = 0
  s.nodelink.trackCacheManager.get = () => {
    reads++
    return { url: 'https://media.invalid/stale?expires=9999999999' }
  }
  request = async () => {
    calls++
    return { statusCode: 503 }
  }
  assert.ok(
    (await s.getTrackUrl({ identifier: '1' }, undefined, true)).exception
  )
  assert.equal(reads, 0)
  assert.equal(calls, 1)
})

test('normal YouTube same-track cache survives while alternate audio uses separate cache identity', async () => {
  const y = youtube()
  const keys = []
  y.nodelink.trackCacheManager = {
    get: (_source, key) => {
      keys.push(key)
      return key === 'chosen'
        ? { url: 'https://media.invalid/original' }
        : undefined
    }
  }
  assert.equal(
    (await y.getTrackUrl(track)).url,
    'https://media.invalid/original'
  )
  assert.ok(
    (await y.getTrackUrl({ ...track, audioTrackId: 'alternate' })).exception
  )
  assert.deepEqual(keys, ['chosen', 'chosen:audio:alternate'])
})
test('SoundCloud direct HLS manifest remains playable and input metadata is not mutated', async () => {
  const body = { hls_aac_160_url: 'https://api.invalid/direct' }
  request = async () => ({ statusCode: 200, body: '#EXTM3U\n#EXT-X-ENDLIST' })
  const r = await sc()._selectTranscoding(body)
  assert.equal(r.protocol, 'hls')
  assert.equal(r.url, 'https://api.invalid/direct?client_id=public-client')
  assert.equal(body.media, undefined)
})

test('manager refuses a replacement leaking through any YouTube source route', async () => {
  const manager = new SourceManager({ options: {}, statsManager: {} })
  manager.sourceMap.set('youtube', {
    getTrackUrl: async () => ({
      url: 'https://media.invalid/bgm',
      newTrack: { info: { ...track, identifier: 'unrelated' } }
    })
  })
  const result = await manager.getTrackUrl(track)
  assert.ok(result.exception)
  assert.equal(result.url, undefined)
})

test('SoundCloud rejects resolver track-ID substitution before requesting media', async () => {
  const s = sc()
  let calls = 0
  request = async () => {
    calls++
    return calls === 1
      ? {
          statusCode: 200,
          body: {
            id: 999,
            media: {
              transcodings: [transcoding('https://api.invalid/other-track')]
            }
          }
        }
      : {
          statusCode: 200,
          body: { url: 'https://media.invalid/wrong-recording' }
        }
  }
  const result = await s.getTrackUrl({ identifier: '300585048' })
  assert.ok(result.exception)
  assert.equal(calls, 1)
})

test('SoundCloud ignores a cache entry bound to another track and recovers the selected ID', async () => {
  const s = sc()
  s.nodelink.trackCacheManager.get = () => ({
    url: 'https://media.invalid/wrong?expires=9999999999',
    additionalData: { trackIdentifier: 'wrong-id' }
  })
  let calls = 0
  request = async () =>
    ++calls === 1
      ? {
          statusCode: 200,
          body: {
            id: 300585048,
            media: {
              transcodings: [transcoding('https://api.invalid/selected')]
            }
          }
        }
      : {
          statusCode: 200,
          body: { url: 'https://media.invalid/selected?expires=9999999999' }
        }
  const result = await s.getTrackUrl({ identifier: '300585048' })
  assert.equal(result.url, 'https://media.invalid/selected?expires=9999999999')
  assert.equal(calls, 2)
})

test('SoundCloud failed forced refresh evicts the failed stream so it cannot return on the next attempt', async () => {
  const s = sc()
  let cached = {
    url: 'https://media.invalid/failed?expires=9999999999',
    additionalData: { trackIdentifier: '300585048' }
  }
  s.nodelink.trackCacheManager.get = () => cached
  s.nodelink.trackCacheManager.delete = () => {
    cached = null
    return true
  }
  request = async () => ({ statusCode: 503 })
  assert.ok(
    (await s.getTrackUrl({ identifier: '300585048' }, undefined, true))
      .exception
  )
  assert.equal(cached, null)
})

test('SoundCloud cold/warm cache, stream-failure refresh and identity recovery remain on one track', async () => {
  const s = sc()
  const cache = new Map()
  s.nodelink.trackCacheManager = {
    get: (_source, id) => cache.get(id),
    set: (_source, id, value) => cache.set(id, value),
    delete: (_source, id) => cache.delete(id)
  }
  const body = {
    id: 300585048,
    media: { transcodings: [transcoding('https://api.invalid/selected')] }
  }
  const responses = [
    { statusCode: 200, body },
    {
      statusCode: 200,
      body: { url: 'https://media.invalid/selected?expires=9999999999' }
    },
    { statusCode: 503 },
    { statusCode: 200, body },
    {
      statusCode: 200,
      body: { url: 'https://media.invalid/recovered?expires=9999999999' }
    }
  ]
  let calls = 0
  request = async () => responses[calls++]
  const info = { identifier: '300585048' }
  const cold = await s.getTrackUrl(info)
  assert.equal(cold.additionalData.trackIdentifier, info.identifier)
  assert.equal((await s.getTrackUrl(info)).url, cold.url)
  assert.equal(calls, 2)
  assert.ok((await s.getTrackUrl(info, undefined, true)).exception)
  assert.equal(cache.size, 0)
  const recovered = await s.getTrackUrl(info)
  assert.equal(recovered.additionalData.trackIdentifier, info.identifier)
  assert.equal(
    recovered.url,
    'https://media.invalid/recovered?expires=9999999999'
  )
  assert.equal(calls, 5)
})
