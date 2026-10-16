# Review of 93103ec and playback changes

Base: dev 152dbb214b6ec6ea4f6fb8397e32ea84549f4564. Compared directly against commit 93103ecfaec833ac63438cb4a8419ee081a6bca4 (PR #1 branch). GitHub API access was unavailable during review, so current PR state and exact Botkeep deployed tree remain unverified. Do not assume syncing a file synced the whole commit/config/dist.

93103ec correctly disables the last YouTube mirror-source fallback unless SBR_ALLOW_YOUTUBE_MIRROR=true. It has no tests and does not cover OLAK re-search, ISRC upscale before YouTube resolution, old mirrored cache entries or alternate audio-track fallback. It also trades substitution for an explicit playback failure: it cannot fix an upstream client/cipher/403 failure or prove audible playback.

This branch incorporates that default strict policy at all those paths, refuses substituted recordings at the manager boundary, isolates alternate audio cache keys, and retains explicit opt-in compatibility. Do not enable mirror opt-in on production as a workaround for unavailable original audio: best-match metadata still cannot establish recording identity.

SoundCloud now honors the source manager's third force-refresh argument, preserves transcoding URL query parameters, prefers media URLs in redirect JSON, rejects HTML/empty/preview/error responses, and tries alternative formats of the SAME track before failure. It does not bypass DRM, provider access controls or guarantee that all current SoundCloud transport formats can be decoded.

Run npm run type-check, npm test (Node 24; module mocking uses Node's experimental test flag), and npm run build -- --outDir /tmp/nodelink-build. Existing config tests and the new source regression suite run without Discord/provider credentials. Provider requests are mocked in the source suite; no real voice output is asserted. Runtime uses no new test dependency.

See the SBR repository docs/PLAYBACK-REVIEW.md for the coordinated manual approval, backup/rollback and real-audio acceptance procedure. Apply this branch relative to the current deployed tree, including 93103ec, never blindly overwrite a synced production tree. No deployment or production operation was performed.
