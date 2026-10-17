# Issue #6 — NodeLink audio stage diagnostics

Issue: https://github.com/khem001/SBR-Music/issues/6
Review branch: `test/issue-6-audio-stage-diagnostics`, based on
`fix/sbr-soundcloud-cache-identity` at
`5784432a7076d8d551a597dc74a6b1d60d34871d`.
Pair with SBR `test/issue-6-synthetic-audio`, based on `2826bd7`.
**No Botkeep deploy/restart/configuration edits, Discord session or provider requests
were made. Production silence is not diagnosed or claimed fixed.**

## Offline evidence — 2026-10-17 UTC

`npm test`: 28/28 pass, including eight new native/diagnostic tests.
`npm run type-check` and `npm run build -- --outDir /workspace/.build/NodeLink` pass.
See `docs/test-results/issue-6-offline.json` for measured aggregate output.

| Stage | Actual offline result | Boundary |
|---|---|---|
| Local source + sandbox + identity | WAV 1,920,044 bytes; SHA marker only for exact reference; tampered file/escape rejected | PASS local filesystem, not Botkeep |
| Native Symphonia → decoded PCM | 960,000 channel samples; RMS 692.76; zero pipeline error events | PASS |
| Post-DSP → native Opus | RMS 692.76; 500 packets, 191,389 bytes | PASS, AGC off / gain 1 |
| Actual transport AES-GCM → in-memory mock UDP | 500 frames encrypt/decrypt exactly; 500 successful mock callbacks | PASS mocked transport; no network socket or Discord receiver |
| Native decoded Opus output | 10.0 s, RMS 694.63, peak 991, 439.4 Hz by positive zero crossings | PASS nonzero reference; lossy Opus, not bit-exact PCM |
| DAVE installed capability | Voice 2.2.15, native `DAVESession`, protocol 1 session construction | PASS capability; no live key exchange/ready/encrypted media proof |
| DAVE counter semantics | Mock ready/bypass/drop paths distinguished, hooks restored; secret sentinel omitted | PASS instrumentation only |
| Actual Discord UDP / DAVE / hearing | Not attempted; existing bot/session only on Botkeep | BLOCKED in Cloud; UNVERIFIED live |
| Real songs | Not attempted pending audible A/B | UNVERIFIED; no source/cache changes |

Both PCM buffers are stereo s16le at 48 kHz. RMS counts channel samples (960,000 =
10 s × 48,000 × 2). Offline decode is unpaced: 10 s of sample data does not prove
10 wall-clock seconds of uninterrupted voice. Mock connection/readiness/key flags
in the JSON are test inputs, not observations of a real connection.

## Implementation boundaries

- `src/diagnostics/audioStages.ts`: default off; one configured guild only;
  5 s aggregate reports; automatic 60 s deadline, no in-process rearm; cleanup
  on player destroy. CPU RMS accounting is capped at 15 s, with no sample storage.
- Input observer attaches after the existing decoder consumer; it does not force
  unread streams to flow or replace the source and its `finishBuffering`/seek
  metadata. PCM taps pass through unchanged; Opus taps preserve packet boundaries.
  Each input has its own hash; `referenceWavMatch` is true only if all completed
  observed inputs match the reference within this window.
- Voice hooks call original methods with original receivers and are restored at
  cleanup. No codec, DAVE, transport, reconnect, search or fallback logic changes.
- Logs contain only counts/booleans, an allowlisted transport mode and DAVE protocol
  number. No guild/user/address, credentials, endpoints, packet bytes, keys, voice
  tokens or raw errors are emitted by this probe. Existing unrelated verbose
  library logs still need review before sharing.
- Existing `sources.local` already accepts WAV. A gated metadata marker hashes
  only the fixed 1.92 MB reference filename. SBR refuses the track unless this
  marker, filename and source match; no new public route/server is introduced.
- `finishBuffering`, disabled gating, native decode, packet boundaries, input
  non-consumption and timeout/wrapper cleanup are regression-tested.

The actual installed `@performanc/voice` contains native DAVE session, external
sender, key package and transition support. Its MLS encrypt method may bypass
while unready/downgrading, or return null on encryption failure; this probe counts
these separately. It does not force readiness, change keys or implement a bypass.
`daveKeyPackageSent=true` alone is not evidence of a usable DAVE session.

## Minimal Botkeep B test — after separate approval and audible SBR test A

Use the **existing** NodeLink host and SBR-001. Never run a duplicate bot in Cloud.
Back up existing deployed SHAs/configuration privately first; obtain explicit
approval before any sync/restart or configuration edit. Record actual installed
voice/DAVE versions and deployment SHAs; they are not known from these checkouts.

1. After approved deployment, inspect actual `sources.local.enabled` and
   `sources.local.basePath` on the existing NodeLink host. Checked-in
   `config.default.ts` uses `enabled:true`, `basePath:'./local-music/'`; the
   class fallback is `./` only if no configured base exists. Do not assume a host
   path or enable a new public source. If the actual source is disabled/unwritable,
   report it and seek the usual configuration approval first.
2. In that existing NodeLink checkout, generate the reference into the approved
   local base using the current Node 24 runtime. For the checked-in base only:

   ```sh
   node scripts/generate-tone.mjs ./local-music/sbr-tone-440hz-10s.wav
   sha256sum ./local-music/sbr-tone-440hz-10s.wav
   ```

   The directory must exist in the private base; create only if separately approved.
   Generator refuses to overwrite a file, uses mode 0600, and never prints the
   destination path. Expected SHA-256:
   `36b1669700eabaa6183d81c2ebf32edb5485dfd66d43db5d2aa974060e0e5fec`.
   If the name exists, check its hash; do not overwrite/delete unknown files.
3. After approval, set the following non-secret diagnostic options on the existing
   NodeLink host via its normal configuration procedure. No new password/token:

   ```text
   NODELINK_AUDIO_DIAGNOSTICS=true
   NODELINK_AUDIO_DIAGNOSTIC_GUILD_ID=<same single guild as SBR tone opt-in>
   ```

   The first matching player/resource starts the one-time 60 s window. Keep this
   guild idle until test B. Do not use normal music in that guild first or re-arm
   automatically. Other guilds are not probed.
4. Follow the SBR guide's gate and run `/tone-test route:nodelink` **once** in the
   same idle guild after A was heard. The temporary player has AGC off, no filters,
   volume 100; the reference itself peaks at about −30.45 dBFS. SBR resolves only
   `local:sbr-tone-440hz-10s.wav`, then stops/destroys/leaves after completion/error.
   Local WAV duration metadata currently reports `-1`; 500 decoded frames prove
   its ten-second duration independently. No unrelated duration parser fix added.
5. Record audible yes/no, continuity, UTC start/end, SBR run ID and both redacted
   log summaries. `pipeline_drained` proves production, not consumption; inspect
   later voice/UDP summaries and the final `player_destroy`/`window_expired` report.

Do not start/stop existing production services to induce failures. After approved
testing, disable both projects' flags through an approved config/restart, restore
the backed-up revisions if rolling back, and remove only this generated asset.
No Neon data, bot identity, normal queue/session/settings or secrets need changing.

## Read the counters with the listening result

| Observation during B | Narrow next check |
|---|---|
| No `inputBytes` / `referenceWavMatch` false | Asset, local base/sandbox, stream delivery |
| Input correct, PCM zero / `errors` >0 | Decoder/input errors (events may be counted at multiple pipeline layers) |
| PCM nonzero, output RMS zero | Gain/filter/DSP |
| Output nonzero, `opusPackets` zero | Encoder/backpressure |
| Opus nonzero, `voiceOpusFrames` zero | Consumer/voice player readiness |
| Voice frames nonzero, no transport frames | Missing key, DAVE drop, unsupported transport; correlate readiness/errors |
| DAVE protocol positive, unready/bypass/drop | Actual negotiation and transition timing |
| Transport nonzero, callbacks fail/absent | UDP socket/send state and host outbound policy |
| Callbacks succeed but silent | Receiver delivery, NAT/firewall, DAVE readiness and Discord client; callbacks are not acknowledgements |

`daveEncryptedFrames` counts transformed non-silence output when protocol >0,
session ready and not pending downgrade; `daveBypassFrames` counts unchanged output;
`daveDroppedFrames` counts null. Transport encryption is a separate layer.
`udpCallbacksSent/Failed` are deltas from the real voice library's OS send callback
statistics, not Discord acknowledgements. DAVE/UDP live correctness cannot be
deduced from the mocked transport test.

If A is silent, fix/verify SBR-host voice first. If A audible and B silent, follow
the first zero/error above; do not patch providers. Only after both are audible,
use one operator-confirmed canonical SoundCloud URL and one YouTube URL for >30 s
each and verify identity/continuity with a listener. Full A/B/C matrix and report
fields are in SBR `ISSUE-6-AUDIO.md`.

## Repeat Cloud checks without network, services or credentials

```sh
npm run type-check
ISSUE6_REPORT_PATH=/tmp/issue-6-offline.json npm test
npm run build -- --outDir /workspace/.build/NodeLink
```

No new dependency; report path optional. Tests use temporary private files and an
in-memory UDP double, never a live Discord connection. Real Botkeep memory/CPU,
outbound UDP permissions and DAVE readiness remain unmeasured. Diagnostic window,
PCM aggregation and single-guild scope bound overhead; no free-plan performance
claim is made from the faster-than-realtime Cloud run.
