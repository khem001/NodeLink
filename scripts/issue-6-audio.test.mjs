import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomBytes, createDecipheriv } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import config from '../config.default.ts'
import Local from '../src/sources/local.ts'
import { createAudioResource } from '../src/playback/processing/streamProcessor.ts'
import { Decoder } from '../src/playback/opus/Opus.ts'
import {
  AudioStageProbe,
  audioProbe,
  audioDiagnosticsSnapshot,
  bindToneRun
} from '../src/diagnostics/audioStages.ts'
import {
  TONE_NAME,
  TONE_WAV_SHA256,
  toneWav
} from '../src/diagnostics/toneReference.ts'
const GID = '100000000000000001'
const report = {
  reference: {
    wavSha256: TONE_WAV_SHA256,
    seconds: 10,
    hz: 440,
    amplitude: 0.03
  },
  discordLive: false,
  providerRequests: 0
}
const collect = async (stream) => {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}
function context(base) {
  const options = structuredClone(config)
  options.sources.local = { enabled: true, basePath: base }
  return { options, extensions: {} }
}
test('local reference is identical to SBR, is accepted under its private base and rejects path escape', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue6-local-'))
  const file = path.join(dir, TONE_NAME)
  fs.writeFileSync(file, toneWav())
  try {
    assert.equal(
      createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
      TONE_WAV_SHA256
    )
    const source = new Local(context(dir))
    const result = await source.resolve(TONE_NAME)
    assert.equal(result.loadType, 'track')
    assert.equal(result.data.info.sourceName, 'local')
    assert.equal(result.data.pluginInfo.syntheticToneSha256, undefined)
    process.env.NODELINK_AUDIO_DIAGNOSTICS = 'true'
    process.env.NODELINK_AUDIO_DIAGNOSTIC_GUILD_ID = GID
    assert.equal(
      (await source.resolve(TONE_NAME)).data.pluginInfo.syntheticToneSha256,
      TONE_WAV_SHA256
    )
    const altered = fs.readFileSync(file)
    altered[100] ^= 1
    fs.writeFileSync(file, altered)
    assert.equal(
      (await source.resolve(TONE_NAME)).data.pluginInfo.syntheticToneSha256,
      undefined
    )
    assert.equal((await source.resolve('../outside.wav')).loadType, 'error')
  } finally {
    delete process.env.NODELINK_AUDIO_DIAGNOSTICS
    delete process.env.NODELINK_AUDIO_DIAGNOSTIC_GUILD_ID
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
test('probe is off by default and gated to one guild; taps preserve chunks and Opus packet boundaries', async () => {
  assert.equal(audioProbe(GID), null)
  process.env.NODELINK_AUDIO_DIAGNOSTICS = 'true'
  process.env.NODELINK_AUDIO_DIAGNOSTIC_GUILD_ID = GID
  assert.equal(audioProbe('other-guild'), null)
  delete process.env.NODELINK_AUDIO_DIAGNOSTICS
  delete process.env.NODELINK_AUDIO_DIAGNOSTIC_GUILD_ID
  const probe = new AudioStageProbe(() => {})
  const tap = probe.tap('opus')
  const chunks = [Buffer.from([1]), Buffer.from([2, 3]), Buffer.from([4])]
  const result = []
  tap.on('data', (chunk) => result.push(chunk))
  await pipeline(Readable.from(chunks), tap)
  assert.deepEqual(result, chunks)
  assert.equal(probe.opusPackets, 3)
  probe.finish()
})
test('actual local WAV -> native decode/DSP -> 500 Opus frames -> AES-GCM -> mocked UDP callback -> native decoded nonzero 440Hz', {
  timeout: 15000
}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue6-pipeline-'))
  fs.writeFileSync(path.join(dir, TONE_NAME), toneWav())
  let resource, connection, probe
  try {
    process.env.NODELINK_AUDIO_DIAGNOSTICS = 'true'
    process.env.NODELINK_AUDIO_DIAGNOSTIC_GUILD_ID = GID
    const voice = (await import('@performanc/voice')).default
    connection = voice.joinVoiceChannel({
      guildId: GID,
      userId: '100000000000000002',
      channelId: '100000000000000003',
      encryption: 'aead_aes256_gcm_rtpsize'
    })
    const key = randomBytes(32)
    connection.udpInfo = { secretKey: key, ssrc: 1 }
    connection.state = { status: 'connected' }
    const decrypted = []
    connection.udp = {
      send(packet, cb) {
        const nonce = Buffer.alloc(12)
        nonce.writeUInt32BE(packet.readUInt32BE(packet.length - 4), 0)
        const decipher = createDecipheriv('aes-256-gcm', key, nonce)
        decipher.setAAD(packet.subarray(0, 12))
        decipher.setAuthTag(packet.subarray(-20, -4))
        decrypted.push(
          Buffer.concat([
            decipher.update(packet.subarray(12, -20)),
            decipher.final()
          ])
        )
        cb()
      }
    }
    probe = audioProbe(GID)
    assert.equal(
      probe.bindRun(
        'tone-nodelink-11111111-2222-4333-8444-555555555555',
        TONE_WAV_SHA256
      ),
      true
    )
    probe.attachVoice(connection)
    const ctx = context(dir),
      source = new Local(ctx)
    const resolved = await source.resolve(TONE_NAME)
    assert.equal(resolved.data.pluginInfo.syntheticToneSha256, TONE_WAV_SHA256)
    const url = source.getTrackUrl(resolved.data.info)
    const input = await source.loadStream(resolved.data.info, url.url)
    resource = createAudioResource(
      GID,
      input.stream,
      input.type,
      ctx,
      {},
      1,
      null,
      false,
      false,
      false
    )
    let finishedBuffering = false
    resource.stream.on('finishBuffering', () => {
      finishedBuffering = true
    })
    let frames = 0
    for await (const packet of resource.stream) {
      connection.sendAudioChunk(packet)
      assert.deepEqual(decrypted.at(-1), packet)
      frames++
    }
    await new Promise((r) => setImmediate(r))
    assert.equal(finishedBuffering, true)
    assert.equal(frames, 500)
    assert.equal(decrypted.length, 500)
    const decoder = new Decoder({ rate: 48000, channels: 2 })
    const pcmPromise = collect(decoder)
    for (const packet of decrypted) decoder.write(packet)
    decoder.end()
    const pcm = await pcmPromise
    let sum = 0,
      peak = 0,
      crossings = 0,
      previous = 0
    for (let i = 0; i < pcm.length; i += 4) {
      const value = pcm.readInt16LE(i)
      sum += value * value
      peak = Math.max(peak, Math.abs(value))
      if (previous < 0 && value >= 0) crossings++
      previous = value
    }
    const seconds = pcm.length / 192000,
      rms = Math.sqrt(sum / (pcm.length / 4)),
      frequency = crossings / seconds
    assert.ok(rms > 500)
    assert.ok(frequency > 430 && frequency < 450)
    const stages = probe.snapshot('offline_test')
    assert.equal(
      audioDiagnosticsSnapshot(GID).runId,
      'tone-nodelink-11111111-2222-4333-8444-555555555555'
    )
    assert.equal(stages.referenceWavMatch, true)
    assert.equal(stages.opusPackets, 500)
    assert.equal(stages.transportEncryptedFrames, 500)
    assert.equal(stages.udpCallbacksSent, 500)
    assert.ok(stages.pcmRms > 500)
    assert.ok(stages.outputRms > 500)
    report.nodeLinkLocal = {
      frames,
      seconds,
      rms,
      peak,
      frequencyHz: frequency,
      stages,
      udpSink: 'loopback-free in-memory mock, not Discord',
      daveLiveNegotiation: false
    }
  } finally {
    probe?.finish('offline_complete')
    resource?.destroy()
    if (connection) {
      connection.udp = null
      connection.destroy()
    }
    delete process.env.NODELINK_AUDIO_DIAGNOSTICS
    delete process.env.NODELINK_AUDIO_DIAGNOSTIC_GUILD_ID
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
test('installed voice stack exposes actual native DAVE and constructs an MLS session without Discord', async () => {
  const native = await import('@snazzah/davey')
  assert.equal(typeof native.DAVESession, 'function')
  assert.ok(native.DAVE_PROTOCOL_VERSION > 0)
  const voice = (await import('@performanc/voice')).default
  const c = voice.joinVoiceChannel({
    guildId: '100000000000000004',
    userId: '100000000000000002',
    channelId: '100000000000000003',
    encryption: 'aead_aes256_gcm_rtpsize'
  })
  c.on('error', () => {})
  try {
    c._initMLSSessionIfNeeded(native.DAVE_PROTOCOL_VERSION)
    assert.ok(c.mlsSession)
    report.daveCapability = {
      voiceVersion: JSON.parse(
        fs.readFileSync(
          new URL('./package.json', import.meta.resolve('@performanc/voice')),
          'utf8'
        )
      ).version,
      daveProtocol: native.DAVE_PROTOCOL_VERSION,
      nativeSessionConstructed: !!c.mlsSession.session,
      readyWithoutDiscord: c.mlsSession.session?.ready ?? false,
      liveNegotiation: false
    }
    assert.equal(c.mlsSession.session?.ready, false)
  } finally {
    c.destroy()
  }
})
test('telemetry distinguishes DAVE bypass, encrypted output and dropped frames, and restores wrappers', () => {
  const snapshots = []
  const probe = new AudioStageProbe((value) => snapshots.push(value))
  const packet = Buffer.from([1, 2, 3, 4])
  let mode = 'bypass'
  const original = function (p) {
    return mode === 'drop'
      ? null
      : mode === 'encrypt'
        ? Buffer.concat([p, Buffer.alloc(16)])
        : p
  }
  const m = {
    protocolVersion: 1,
    session: { ready: false },
    externalSenderSet: false,
    encrypt: original
  }
  const send = function (p) {
    const encrypted = this.mlsSession.encrypt(p)
    if (encrypted) this._sendEncryptedPacket(encrypted)
  }
  const c = {
    mlsSession: m,
    udpInfo: { secretKey: Buffer.from('SECRET_SENTINEL') },
    udp: {},
    statistics: { packetsSent: 0, packetsLost: 0 },
    sendAudioChunk: send,
    _sendEncryptedPacket() {
      this.statistics.packetsSent++
    }
  }
  probe.attachVoice(c)
  c.sendAudioChunk(packet)
  mode = 'encrypt'
  m.session.ready = true
  c.sendAudioChunk(packet)
  mode = 'drop'
  c.sendAudioChunk(packet)
  const result = probe.snapshot('test')
  assert.equal(result.daveBypassFrames, 1)
  assert.equal(result.daveEncryptedFrames, 1)
  assert.equal(result.daveDroppedFrames, 1)
  assert.equal(result.transportEncryptedFrames, 2)
  assert.ok(!JSON.stringify(result).includes('SECRET_SENTINEL'))
  probe.finish()
  assert.equal(c.sendAudioChunk, send)
  assert.equal(m.encrypt, original)
})
test('window expiry restores hooks and stops summaries automatically', async () => {
  const probe = new AudioStageProbe(() => {}, 5)
  const c = { sendAudioChunk() {} }
  const original = c.sendAudioChunk
  probe.attachVoice(c)
  await new Promise((r) => setTimeout(r, 15))
  assert.equal(probe.closed, true)
  assert.equal(c.sendAudioChunk, original)
})
process.on('exit', () => {
  if (process.env.ISSUE6_REPORT_PATH)
    fs.writeFileSync(
      process.env.ISSUE6_REPORT_PATH,
      JSON.stringify(report, null, 2)
    )
})

test('input observation never starts an unconsumed source flowing', () => {
  const source = new Readable({
    read() {
      throw Error('Unexpected consumption')
    }
  })
  const probe = new AudioStageProbe(() => {})
  probe.observeInput(source)
  assert.equal(source.readableFlowing, null)
  assert.equal(source.listenerCount('data'), 0)
  probe.finish()
  source.destroy()
})

test('successive sources in the diagnostic window cannot reuse a finalized input hash', async () => {
  const probe = new AudioStageProbe(() => {})
  try {
    for (const content of [
      toneWav(),
      toneWav(),
      Buffer.from('not the reference')
    ]) {
      const stream = Readable.from([content])
      stream.on('data', () => {})
      probe.observeInput(stream)
      await new Promise((resolve) => stream.once('end', resolve))
    }
    assert.equal(probe.snapshot('multiple_sources').referenceWavMatch, false)
    assert.equal(
      probe.inputBytes,
      1920044 * 2 + Buffer.byteLength('not the reference')
    )
  } finally {
    probe.finish()
  }
})

test('run binding rejects invalid/stale contexts and final snapshot retains observed readiness without retaining keys', () => {
  const p = new AudioStageProbe(() => {})
  const run = 'tone-nodelink-11111111-2222-4333-8444-555555555555'
  assert.equal(p.bindRun('SECRET_SENTINEL', TONE_WAV_SHA256), false)
  assert.equal(p.bindRun(run, 'wrong-reference'), false)
  assert.equal(p.bindRun(run, TONE_WAV_SHA256), true)
  assert.equal(p.bindRun(run, TONE_WAV_SHA256), false)
  const c = {
    state: { status: 'connected' },
    udp: {},
    udpInfo: { secretKey: Buffer.from('SECRET_SENTINEL') },
    statistics: { packetsSent: 3, packetsLost: 0 }
  }
  p.attachVoice(c)
  c.statistics.packetsSent = 503
  p.finish('player_destroy')
  c.state.status = 'destroyed'
  c.udpInfo = null
  const saved = p.snapshot('get_after_cleanup')
  assert.equal(saved.runId, run)
  assert.equal(saved.closed, true)
  assert.equal(saved.voiceConnected, true)
  assert.equal(saved.udpSecretPresent, true)
  assert.equal(saved.udpCallbacksSent, 500)
  assert.ok(!JSON.stringify(saved).includes('SECRET_SENTINEL'))
  const late = new AudioStageProbe(() => {})
  late.inputBytes = 1
  assert.equal(late.bindRun(run, TONE_WAV_SHA256), false)
  late.finish()
})
test('existing player JSON exposes metadata only when opted in; a read cannot create or re-arm diagnostics', async () => {
  const { Player } = await import('../src/playback/player.ts')
  const guildId = '100000000000000005',
    run = 'tone-nodelink-11111111-2222-4333-8444-555555555555'
  const fake = {
    guildId,
    track: null,
    volumePercent: 100,
    isPaused: false,
    filters: {},
    connStatus: 'connected',
    connection: null,
    voice: { token: 'SECRET_SENTINEL' },
    _realPosition: () => 0
  }
  assert.equal(Player.prototype.toJSON.call(fake).audioDiagnostics, undefined)
  try {
    process.env.NODELINK_AUDIO_DIAGNOSTICS = 'true'
    process.env.NODELINK_AUDIO_DIAGNOSTIC_GUILD_ID = guildId
    assert.equal(audioDiagnosticsSnapshot(guildId), null)
    assert.equal(Player.prototype.toJSON.call(fake).audioDiagnostics, undefined)
    assert.equal(
      bindToneRun(
        guildId,
        { sourceName: 'youtube', uri: '/private/' + TONE_NAME },
        { sbrToneRunId: run, sbrToneReferenceSha256: TONE_WAV_SHA256 }
      ),
      false
    )
    assert.equal(audioDiagnosticsSnapshot(guildId), null)
    assert.equal(
      bindToneRun(
        guildId,
        { sourceName: 'local', uri: '/private/' + TONE_NAME },
        { sbrToneRunId: run, sbrToneReferenceSha256: TONE_WAV_SHA256 }
      ),
      true
    )
    const p = audioProbe(guildId)
    const data = Player.prototype.toJSON.call(fake).audioDiagnostics
    assert.equal(data.runId, run)
    assert.ok(!JSON.stringify(data).includes('SECRET_SENTINEL'))
    assert.equal(
      Player.prototype.toJSON.call({ ...fake, guildId: 'other' })
        .audioDiagnostics,
      undefined
    )
    p.finish()
    assert.equal(audioProbe(guildId), null)
    assert.equal(audioDiagnosticsSnapshot(guildId).closed, true)
    delete process.env.NODELINK_AUDIO_DIAGNOSTICS
    assert.equal(Player.prototype.toJSON.call(fake).audioDiagnostics, undefined)
  } finally {
    delete process.env.NODELINK_AUDIO_DIAGNOSTICS
    delete process.env.NODELINK_AUDIO_DIAGNOSTIC_GUILD_ID
  }
})
test('request log projection redacts voice credentials recursively without altering the live request', async () => {
  const { redactRequestField } = await import(
    '../src/diagnostics/redactRequest.ts'
  )
  const { LogSanitizer } = await import('../src/utils/sanitizer.ts')
  const request = {
    voice: {
      token: 'SECRET_SENTINEL',
      endpoint: 'SECRET_SENTINEL',
      sessionId: 'SECRET_SENTINEL'
    },
    track: {
      userData: { sbrToneRunId: 'safe-correlation', token: 'SECRET_SENTINEL' }
    },
    nested: {
      Password: 'SECRET_SENTINEL',
      authorization: 'SECRET_SENTINEL',
      secretKey: 'SECRET_SENTINEL'
    },
    volume: 100
  }
  const before = structuredClone(request),
    output = JSON.stringify(request, redactRequestField)
  const sanitizer = new LogSanitizer()
  assert.ok(
    sanitizer.sanitize(JSON.stringify(request)).includes('SECRET_SENTINEL')
  )
  assert.ok(!sanitizer.sanitize(output).includes('SECRET_SENTINEL'))
  assert.ok(!output.includes('SECRET_SENTINEL'))
  assert.ok(output.includes('safe-correlation'))
  assert.equal(JSON.parse(output).volume, 100)
  assert.deepEqual(request, before)
})
