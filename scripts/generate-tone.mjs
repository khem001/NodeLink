import fs from 'node:fs'
import path from 'node:path'
import {
  toneWav,
  TONE_NAME,
  TONE_WAV_SHA256
} from '../src/diagnostics/toneReference.ts'
const output = process.argv[2]
if (!output || path.basename(output) !== TONE_NAME)
  throw Error('Specify a new private path ending in ' + TONE_NAME)
fs.writeFileSync(output, toneWav(), { flag: 'wx', mode: 0o600 })
console.log(
  JSON.stringify({
    bytes: 1920044,
    seconds: 10,
    rate: 48000,
    channels: 2,
    hz: 440,
    amplitude: 0.03,
    wavSha256: TONE_WAV_SHA256
  })
)
