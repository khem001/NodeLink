import { createHash } from 'node:crypto'
import { Transform, type Readable } from 'node:stream'

import { TONE_WAV_SHA256 } from './toneReference.ts'
type MLS = {
  protocolVersion?: number
  session?: { ready?: boolean }
  externalSenderSet?: boolean
  transitioning?: boolean
  reinitializing?: boolean
  _pendingDowngrade?: boolean
  encrypt?: (packet: Buffer) => Buffer | null
}
type Connection = {
  state?: { status?: string }
  udp?: unknown
  udpInfo?: { secretKey?: unknown }
  encryption?: string
  statistics?: {
    packetsSent?: number
    packetsLost?: number
    packetsExpected?: number
  }
  mlsSession?: MLS
  _keyPackageSent?: boolean
  sendAudioChunk?: (packet: Buffer) => unknown
  _sendEncryptedPacket?: (packet: Buffer) => unknown
}
const probes = new Map<string, AudioStageProbe>()
export function audioProbe(guildId: string): AudioStageProbe | null {
  if (
    process.env.NODELINK_AUDIO_DIAGNOSTICS !== 'true' ||
    !/^\d{17,20}$/.test(process.env.NODELINK_AUDIO_DIAGNOSTIC_GUILD_ID ?? '') ||
    guildId !== process.env.NODELINK_AUDIO_DIAGNOSTIC_GUILD_ID
  )
    return null
  if (!probes.has(guildId))
    probes.set(
      guildId,
      new AudioStageProbe((value) =>
        console.log('NODELINK AUDIO STAGES:', JSON.stringify(value))
      )
    )
  const probe = probes.get(guildId)!
  return probe.closed ? null : probe
}
export class AudioStageProbe {
  inputBytes = 0
  pcmSamples = 0
  outputSamples = 0
  opusPackets = 0
  opusBytes = 0
  errors = 0
  voiceOpusFrames = 0
  transportEncryptedFrames = 0
  daveEncryptedFrames = 0
  daveBypassFrames = 0
  daveDroppedFrames = 0
  private pcmSquares = 0
  private outputSquares = 0
  private referenceMatch: boolean | null = null
  private connection: Connection | null = null
  private baselineSent = 0
  private baselineLost = 0
  private cleanups: Array<() => void> = []
  private sessions = new WeakSet<object>()
  private started = Date.now()
  private timer: ReturnType<typeof setInterval>
  private deadline: ReturnType<typeof setTimeout>
  closed = false
  private emit: (value: Record<string, unknown>) => void
  constructor(
    emit: (value: Record<string, unknown>) => void,
    windowMs = 60000
  ) {
    this.emit = emit
    this.timer = setInterval(() => this.report('periodic'), 5000)
    this.timer.unref?.()
    this.deadline = setTimeout(() => this.finish('window_expired'), windowMs)
    this.deadline.unref?.()
  }
  observeInput(input: Readable) {
    // Attach only after the real decoder pipeline has a consumer. Never put
    // an unconsumed source in flowing mode or replace its event/seek metadata.
    if (input.listenerCount('data') === 0) return
    const hash = createHash('sha256')
    const onData = (chunk: Buffer) => {
      if (!this.closed) {
        this.inputBytes += chunk.length
        hash.update(chunk)
      }
    }
    const cleanup = () => {
      input.off('data', onData)
      input.off('end', onEnd)
      input.off('close', cleanup)
    }
    const onEnd = () => {
      if (!this.closed) {
        const match = hash.digest('hex') === TONE_WAV_SHA256
        this.referenceMatch = (this.referenceMatch ?? true) && match
      }
      cleanup()
    }
    input.on('data', onData)
    input.once('end', onEnd)
    input.once('close', cleanup)
    this.cleanups.push(cleanup)
  }
  tap(stage: 'pcm' | 'output' | 'opus'): Transform {
    const probe = this
    return new Transform({
      readableObjectMode: stage === 'opus',
      writableObjectMode: stage === 'opus',
      transform(chunk: Buffer, _encoding, done) {
        if (!probe.closed) {
          if (stage === 'opus') {
            probe.opusPackets++
            probe.opusBytes += chunk.length
          } else {
            // Aggregate at most 15 seconds; retain neither samples nor addresses.
            const current =
              stage === 'pcm' ? probe.pcmSamples : probe.outputSamples
            const count = Math.min(
              Math.floor(chunk.length / 2),
              Math.max(0, 48000 * 2 * 15 - current)
            )
            let square = 0
            for (let i = 0; i < count; i++) {
              const sample = chunk.readInt16LE(i * 2)
              square += sample * sample
            }
            if (stage === 'pcm') {
              probe.pcmSamples += count
              probe.pcmSquares += square
            } else {
              probe.outputSamples += count
              probe.outputSquares += square
            }
          }
        }
        done(null, chunk)
      }
    })
  }
  error() {
    this.errors++
  }
  attachVoice(raw: unknown) {
    if (this.closed || this.connection) return
    const c = raw as Connection
    this.connection = c
    this.baselineSent = c.statistics?.packetsSent ?? 0
    this.baselineLost = c.statistics?.packetsLost ?? 0
    const watchMLS = () => {
      const m = c.mlsSession
      if (!m?.encrypt || this.sessions.has(m)) return
      this.sessions.add(m)
      const original = m.encrypt
      const probe = this
      const wrapped = function (packet: Buffer) {
        const silent =
          packet.length === 3 &&
          packet[0] === 0xf8 &&
          packet[1] === 0xff &&
          packet[2] === 0xfe
        const result = original.call(m, packet)
        if (!silent && !probe.closed && (m.protocolVersion ?? 0) > 0) {
          if (!result) probe.daveDroppedFrames++
          else if (
            result !== packet &&
            m.session?.ready &&
            !m._pendingDowngrade
          )
            probe.daveEncryptedFrames++
          else probe.daveBypassFrames++
        }
        return result
      }
      m.encrypt = wrapped
      this.cleanups.push(() => {
        if (m.encrypt === wrapped) m.encrypt = original
      })
    }
    if (c.sendAudioChunk) {
      const original = c.sendAudioChunk
      const probe = this
      const wrapped = function (packet: Buffer) {
        watchMLS()
        if (!probe.closed) probe.voiceOpusFrames++
        return original.call(c, packet)
      }
      c.sendAudioChunk = wrapped
      this.cleanups.push(() => {
        if (c.sendAudioChunk === wrapped) c.sendAudioChunk = original
      })
    }
    if (c._sendEncryptedPacket) {
      const original = c._sendEncryptedPacket
      const probe = this
      const wrapped = function (packet: Buffer) {
        if (!probe.closed) probe.transportEncryptedFrames++
        return original.call(c, packet)
      }
      c._sendEncryptedPacket = wrapped
      this.cleanups.push(() => {
        if (c._sendEncryptedPacket === wrapped)
          c._sendEncryptedPacket = original
      })
    }
    this.report('voice_attached')
  }
  snapshot(reason: string): Record<string, unknown> {
    const c = this.connection,
      m = c?.mlsSession
    return {
      reason,
      elapsedMs: Date.now() - this.started,
      inputBytes: this.inputBytes,
      referenceWavMatch: this.referenceMatch,
      pcmSamples: this.pcmSamples,
      pcmRms: this.pcmSamples
        ? Math.sqrt(this.pcmSquares / this.pcmSamples)
        : 0,
      outputSamples: this.outputSamples,
      outputRms: this.outputSamples
        ? Math.sqrt(this.outputSquares / this.outputSamples)
        : 0,
      opusPackets: this.opusPackets,
      opusBytes: this.opusBytes,
      errors: this.errors,
      voiceOpusFrames: this.voiceOpusFrames,
      transportEncryptedFrames: this.transportEncryptedFrames,
      udpSocketPresent: !!c?.udp,
      udpSecretPresent: !!c?.udpInfo?.secretKey,
      voiceConnected: c?.state?.status === 'connected',
      voiceState: [
        'connecting',
        'connected',
        'disconnected',
        'destroyed'
      ].includes(c?.state?.status ?? '')
        ? c?.state?.status
        : null,
      transportMode: [
        'aead_aes256_gcm_rtpsize',
        'aead_xchacha20_poly1305_rtpsize'
      ].includes(c?.encryption ?? '')
        ? c?.encryption
        : null,
      daveSessionPresent: !!m,
      daveProtocol: m?.protocolVersion ?? null,
      daveReady: m?.session?.ready ?? null,
      daveExternalSenderSet: m?.externalSenderSet ?? null,
      daveKeyPackageSent: c?._keyPackageSent ?? null,
      daveTransitioning: m?.transitioning ?? null,
      daveEncryptedFrames: this.daveEncryptedFrames,
      daveBypassFrames: this.daveBypassFrames,
      daveDroppedFrames: this.daveDroppedFrames,
      udpCallbacksSent: Math.max(
        0,
        (c?.statistics?.packetsSent ?? 0) - this.baselineSent
      ),
      udpCallbacksFailed: Math.max(
        0,
        (c?.statistics?.packetsLost ?? 0) - this.baselineLost
      ),
      audibleVerified: false
    }
  }
  report(reason: string) {
    if (!this.closed) this.emit(this.snapshot(reason))
  }
  finish(reason = 'cleanup') {
    if (this.closed) return
    this.report(reason)
    this.closed = true
    clearInterval(this.timer)
    clearTimeout(this.deadline)
    for (const cleanup of this.cleanups) cleanup()
    this.cleanups = []
    this.connection = null
  }
}
