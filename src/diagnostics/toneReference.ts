// Same immutable 10s reference recipe as SBR-Music synthetic-tone.js.
export const TONE_NAME = 'sbr-tone-440hz-10s.wav'
export const TONE_WAV_SHA256 =
  '36b1669700eabaa6183d81c2ebf32edb5485dfd66d43db5d2aa974060e0e5fec'
export function toneWav(): Buffer {
  const pcm = Buffer.alloc(48000 * 10 * 4),
    h = Buffer.alloc(44)
  for (let frame = 0; frame < 480000; frame++) {
    const gain = Math.min(1, frame / 2400, (479999 - frame) / 2400)
    const value = Math.round(
      32767 *
        0.03 *
        Math.max(0, gain) *
        Math.sin((2 * Math.PI * 440 * frame) / 48000)
    )
    pcm.writeInt16LE(value, frame * 4)
    pcm.writeInt16LE(value, frame * 4 + 2)
  }
  h.write('RIFF')
  h.writeUInt32LE(pcm.length + 36, 4)
  h.write('WAVEfmt ', 8)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(2, 22)
  h.writeUInt32LE(48000, 24)
  h.writeUInt32LE(192000, 28)
  h.writeUInt16LE(4, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}
