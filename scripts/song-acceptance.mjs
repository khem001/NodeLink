// Bounded real SoundCloud source diagnostic; starts no HTTP/Discord server.
// HTTP adapter forwards real requests through the platform proxy, never fabricates provider data.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { mock } from 'node:test'
import { spawnSync } from 'node:child_process'
import * as original from '../src/utils.ts'
const root = process.argv[2]
if (!root)
  throw Error(
    'Usage: node --experimental-test-module-mocks scripts/song-acceptance.mjs /absolute/private/output-directory'
  )
if (!root.startsWith('/'))
  throw Error('Use an absolute output directory outside this repository')
if (root.startsWith(fileURLToPath(new URL('../', import.meta.url))))
  throw Error('Keep signed URLs and media outputs outside the repository')
fs.mkdirSync(root, { recursive: true, mode: 0o700 })
process.umask(0o077)
const record = {
  scope:
    'Actual NodeLink source/manager code with real HTTP routed through provided Cloud proxy; no fabricated provider response, no Discord/server',
  timeUTC: new Date().toISOString(),
  requests: [],
  proxyAdapter: true
}
const clean = (e) =>
  String(e?.message ?? e)
    .replace(/https?:\/\/\S+/g, '[URL redacted]')
    .slice(0, 500)
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy
if (!proxy) throw Error('Required Cloud proxy route unavailable')
let budget = 32
async function request(url, options = {}) {
  const target = new URL(url)
  if (--budget < 0) throw Error('Diagnostic request budget reached')
  const entry = { host: target.hostname, path: target.pathname }
  record.requests.push(entry)
  try {
    const result = await original.http1makeRequest(url, {
      ...options,
      proxy: { url: proxy, type: 'forward' },
      maxRetries: 0,
      timeout: 8000
    })
    entry.status = result.statusCode
    if (target.pathname === '/resolve' && result.body?.id)
      entry.resolvedTrackId = String(result.body.id)
    entry.error = result.error ? clean(result.error) : undefined
    return result
  } catch (e) {
    entry.error = clean(e)
    throw e
  }
}
mock.module('../src/utils.ts', {
  namedExports: {
    ...original,
    http1makeRequest: request,
    makeRequest: request,
    logger() {}
  }
})
const { default: SoundCloud } = await import('../src/sources/soundcloud.ts')
const { default: Sources } = await import('../src/managers/sourceManager.ts')
const { default: defaults } = await import('../config.default.ts')
const options = structuredClone(defaults)
options.search.maxResults = 5
const credentials = new Map(),
  cache = new Map()
let cacheHits = 0,
  cacheReads = 0
const context = {
  options,
  credentialManager: {
    get: (k) => credentials.get(k),
    set: (k, v) => credentials.set(k, v)
  },
  trackCacheManager: {
    get: (_source, id) => {
      cacheReads++
      if (cache.has(id)) cacheHits++
      return cache.get(id)
    },
    set: (_source, id, v) => cache.set(id, v),
    delete: (_source, id) => cache.delete(id)
  },
  statsManager: {}
}
const source = new SoundCloud(context)
const manager = new Sources(context)
context.sources = manager
manager.sources.set('soundcloud', source)
manager.sourceMap.set('soundcloud', source)
manager.searchAliasMap.set('scsearch', source)
const deadline = setTimeout(() => {
  record.deadlineExceeded = true
  fs.writeFileSync(
    root + '/nodelink-live.json',
    JSON.stringify(record, null, 2)
  )
  process.exit(2)
}, 60000)
let mediaStream
try {
  record.setup = await source.setup()
  if (!record.setup) throw Error('SoundCloud source setup failed')
  const result = await manager.search(
    'scsearch',
    'Elektronomia Sky High NCS Release'
  )
  record.search = {
    loadType: result.loadType,
    tracks: Array.isArray(result.data) ? result.data.map((t) => t.info) : [],
    error: result.loadType === 'error' ? result.data : undefined
  }
  const selected = Array.isArray(result.data)
    ? result.data.find(
        (t) =>
          t.info.identifier === '300585048' &&
          t.info.uri ===
            'https://soundcloud.com/elektronomia/elektronomia-sky-high'
      )
    : null
  if (!selected) throw Error('Exact candidate not found; no alternate selected')
  record.selected = selected.info
  const resolved = await manager.getTrackUrl(selected.info)
  const summarize = (r) => ({
    ok: !r.exception,
    exception: r.exception
      ? {
          message: clean(r.exception.message),
          cause: clean(r.exception.cause ?? '')
        }
      : undefined,
    protocol: r.protocol,
    format: r.format,
    host: r.url ? new URL(r.url).hostname : undefined,
    replacement: r.newTrack?.info ?? null
  })
  record.cold = summarize(resolved)
  const warm = await manager.getTrackUrl(selected.info)
  record.warm = summarize(warm)
  const refreshed = await manager.getTrackUrl(selected.info, undefined, true)
  record.identityRefresh = summarize(refreshed)
  record.resolvedBinding = resolved.additionalData?.trackIdentifier ?? null
  record.refreshedBinding = refreshed.additionalData?.trackIdentifier ?? null
  record.cache = { reads: cacheReads, hits: cacheHits, entries: cache.size }
  if (resolved.exception || !resolved.url)
    throw Error('NodeLink failed stream resolution')
  fs.writeFileSync(
    root + '/nodelink-url.private.json',
    JSON.stringify({
      url: resolved.url,
      info: selected.info,
      protocol: resolved.protocol,
      additionalData: resolved.additionalData
    })
  )
  const loaded = await manager.getTrackStream(
    selected.info,
    resolved.url,
    resolved.protocol,
    resolved.additionalData
  )
  mediaStream = loaded.stream
  const chunks = []
  let bytes = 0
  const sample = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      mediaStream.destroy()
      resolve(Buffer.concat(chunks))
    }, 8000)
    mediaStream.on('data', (chunk) => {
      chunks.push(chunk)
      bytes += chunk.length
      if (bytes > 768 * 1024) {
        clearTimeout(timer)
        mediaStream.destroy()
        resolve(Buffer.concat(chunks))
      }
    })
    mediaStream.on('end', () => {
      clearTimeout(timer)
      resolve(Buffer.concat(chunks))
    })
    mediaStream.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
  })
  const samplePath = root + '/nodelink-skyhigh.media'
  fs.writeFileSync(samplePath, sample)
  record.stream = { bytes: sample.length, type: loaded.type ?? null }
  const decoded = spawnSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      samplePath,
      '-t',
      '15',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-f',
      's16le',
      root + '/nodelink-skyhigh.pcm',
      '-y'
    ],
    { encoding: 'utf8', timeout: 15000 }
  )
  record.decode = {
    exit: decoded.status,
    error: clean(decoded.stderr || ''),
    audibleIdentityVerified: false
  }
  if (decoded.status === 0) {
    const pcm = fs.readFileSync(root + '/nodelink-skyhigh.pcm')
    let sum = 0,
      peak = 0
    for (let i = 0; i + 1 < pcm.length; i += 2) {
      const v = pcm.readInt16LE(i)
      sum += v * v
      peak = Math.max(peak, Math.abs(v))
    }
    record.decode = {
      ...record.decode,
      seconds: pcm.length / 32000,
      rms: Math.sqrt(sum / (pcm.length / 2)),
      peak
    }
  }
} catch (e) {
  record.error = clean(e)
} finally {
  clearTimeout(deadline)
  mediaStream?.destroy()
  fs.writeFileSync(
    root + '/nodelink-live.json',
    JSON.stringify(record, null, 2)
  )
  console.log(JSON.stringify(record, null, 2))
}

process.exitCode =
  record.error || record.decode?.exit !== 0 || record.decode?.seconds < 10
    ? 1
    : 0
