# SBR Music / NodeLink: three-song acceptance evidence

Test date: 2026-10-16 (timestamps inside evidence are UTC; Bangkok = UTC+7). SBR baseline fe16dc1b98a95a472656cb36f3ec56e4f91071dd remained unchanged. NodeLink baseline de3c27359696019091ac1f7c5c0ed0cf22bcca72 was tested first, then the follow-up fix/sbr-soundcloud-cache-identity branch was tested. No Production credentials, Discord login, Neon access, Botkeep changes, restart, deployment or merge occurred.

## Results

| Requested song | Overall | Evidence and limits |
|---|---|---|
| STARTRIP — Julia (CV: Aimi), YouTube | **BLOCKED** | Exact title/artist search returned proxy CONNECT 403. No canonical URL/ID/duration/version verified. No substitute selected. This is not a NodeLink origin/cipher failure. |
| แสงสุดท้าย — Bodyslam, YouTube | **BLOCKED** | Thai title/artist search returned proxy CONNECT 403. Original studio/MV/live/remaster version and URL remain unverified. No substitute selected. |
| Sky High — Elektronomia [NCS Release], SoundCloud | **UNVERIFIED** overall; technical source/stream/sample consistency **PASS** | Artist-upload candidate at https://soundcloud.com/elektronomia/elektronomia-sky-high ; ID 300585048, sourceName soundcloud, author Elektronomia, 236.301 s, ISRC QM42K1701373. Actual NodeLink search/resolution/cache/HLS loading and 15 s decode succeeded. The sample matches a separate extraction from the SAME upload; an independently approved master/reference and Discord listening are missing. |

No actual-song **FAIL** is asserted from network restrictions. Fault-injection failures below are separately labelled simulated code defects. Artist/title/ISRC metadata corroborates the Sky High candidate; it cannot independently certify the original master/version or identify a mislabeled upload. The artist description calls it an NCS release and links https://youtu.be/92f3RRkakO8 as a reference, but that reference audio was not retrieved because YouTube is blocked. The public metadata license label is all-rights-reserved; the description permits credited video use. No music files are committed or redistributed in this report.

Search results also included a repost (ID 324716355), Sky High pt. II (947160523), Carpe Remix (2232651059), and The Sky High (2240356430). They were explicitly NOT selected. See extractor-search.json and nodelink-de3c273-baseline.json for results, authors, URIs and lengths.

## Actual NodeLink source-path test

The isolated diagnostic imports the review source and SourcesManager without starting NodeLink's HTTP listener, worker cluster or Discord. It registers only SoundCloud. An explicit test transport adapter forwards real HTTP requests through the platform-provided HTTPS_PROXY, preserving TLS verification, existing access controls, an 8-second request timeout and 32-request cap. Provider responses are not fabricated. Default direct NodeLink routing and a Production network are not certified by this adapter test.

Baseline: setup, scsearch, exact selected-ID getTrackUrl, warm cache hit, real HLS getTrackStream and ffmpeg decoding all succeeded. Follow-up: cold, warm (2 reads / 1 hit / 1 entry), forced identity refresh and the HLS loader succeeded again; both API resolve responses were ID 300585048, and no newTrack replacement was observed. The source returned hls/aac_hls and HLSHandler type fmp4-buffered. Follow-up used 14 bounded transport requests, including segment prefetch; one final prefetched request may be cancelled when sampling stops. This is not a fallback to another song.

Captured 808,892 media bytes, then decoded exactly 15 s to mono 16kHz s16le PCM. RMS 6399.755, absolute peak 32768 (peak magnitude alone is not a clipping diagnosis). No filters or Voice/Opus stage were tested. The candidate is sampled at the beginning; the full recording/continuous transitions are not covered by a 15-second sample.

## Audio comparison and provenance limit

Reference/control path: a separate yt-dlp resolution of the exact same artist-upload URL, decoded with ffmpeg to the same PCM parameters and interval. Candidate path: actual NodeLink source/manager/HLS loader, then ffmpeg. Both PCM SHA-256 values are:

`0028ccc3d991ecda20a780e32a8dd33ac1894079d8c36c32ddad8848272990e6`

Chromaprint algorithm 1 produced 100 raw words per sample, best alignment 0 frames, Hamming bit error rate **0.0**. Thus this specific 15-second PCM sample is byte-identical across the two paths. This rules out a difference between those captured paths for that interval; it does NOT independently prove artist/master/version, another interval, full-track correctness, a reference the operator has not approved, or what a Discord listener heard. No fuzzy match threshold is invented. See fingerprint-comparison.json. A synthetic 15-second 440Hz tone negative control correctly differs in PCM and fingerprint (fingerprint-negative-control.json); this sanity check does not calibrate a general fuzzy recording-match threshold.

Still needed, in one operator response: original/version URLs for both YouTube songs; confirmation of the Sky High artist-upload version; independently authorized reference audio URL(s) and relevant sample offsets (10–30 s, preferably matching the tested interval). No Token, DATABASE_URL or Botkeep settings are needed. Until then overall original-audio identity stays UNVERIFIED even where technical checks pass.

## Regression and fault injection

SBR fe16dc1: **19/19 pass** unchanged, including Queue/Skip/Pause/Resume/natural and Loop transitions, pending-resolve races, one-track retry/drop, missing-start watchdog, session recovery, HTTP 503 and real Shoukaku against a temporary loopback WebSocket 1006/HTTP 503 mock. It is not real Discord Voice.

NodeLink de3c273: **16/16 existing tests pass**. Added three fault injections first: wrong API track ID, wrong-ID cached stream, and failed forced refresh leaving its failed URL cached. All three failed on the baseline (16 pass / 3 fail), demonstrating missing source/cache identity safeguards. These are simulated faults, not observed wrong-song incidents from SoundCloud.

The follow-up validates API response ID before requesting media, binds cache entries to the chosen track ID (old/unbound cache entries refresh once), and evicts a failed stream on forced refresh. Four new tests include a complete cold/warm/503/refresh/identity-recovery sequence. **20/20 tests pass**, with type-check and external-output build passing. No global cache purge, database change or Production operation is required. This follows the earlier review's strict YouTube policy; YouTube content remains blocked for real testing.

## Reproduce safely

Use Node 24+, current review dependencies, Python 3, and ffmpeg with Chromaprint. No secrets are needed. Keep all generated signed URLs/media outside Git and outside shared Production hosts.

    npm run type-check
    npm test
    npm run build -- --outDir /tmp/nodelink-test-build
    node --experimental-test-module-mocks scripts/song-acceptance.mjs /tmp/sbr-song-acceptance

The last command makes bounded real SoundCloud requests through the provided Cloud proxy and exits nonzero if sample decoding fails. It never starts a bot or server. The diagnostic uses exactly the candidate ID above rather than choosing a similar title. Raw media and signed stream URL files are private diagnostic outputs, not report artifacts to share.

For independently authorized, aligned 16kHz mono s16le PCM samples:

    python3 scripts/compare-audio-samples.py candidate.pcm reference.pcm --reference-provenance 'operator-approved original/version and interval'

The comparison script has no network access, rejects samples outside 10–30 s, and reports measurements rather than assigning recording provenance. Live acceptance is specified in LIVE-ACCEPTANCE.md.
