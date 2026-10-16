#!/usr/bin/env python3
"""Compare 16kHz mono signed-16-bit PCM samples; no networking or provenance claims."""
import argparse, hashlib, json, pathlib, struct, subprocess
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('candidate'); p.add_argument('reference')
p.add_argument('--reference-provenance', required=True, help='Describe who approved the reference/version; or say same-source transport control')
a = p.parse_args(); samples = []; fingerprints = []
for filename in [a.candidate, a.reference]:
    data = pathlib.Path(filename).read_bytes()
    if not 10 <= len(data) / 32000 <= 30:
        raise SystemExit('Samples must be 10-30 seconds of 16kHz mono s16le PCM')
    run = subprocess.run(['ffmpeg', '-v', 'error', '-f', 's16le', '-ar', '16000', '-ac', '1', '-i', filename, '-f', 'chromaprint', '-algorithm', '1', '-fp_format', 'raw', 'pipe:1'], capture_output=True, timeout=15)
    if run.returncode or not run.stdout or len(run.stdout) % 4:
        raise SystemExit('Chromaprint extraction failed; no match result produced')
    fingerprints.append(struct.unpack('<' + 'I' * (len(run.stdout) // 4), run.stdout))
    samples.append({'seconds': len(data) / 32000, 'pcm_sha256': hashlib.sha256(data).hexdigest()})
comparisons = []
for shift in range(-4, 5):
    first, second = fingerprints
    pairs = list(zip(first[max(0, shift):], second[max(0, -shift):]))
    if pairs:
        comparisons.append({'shift_frames': shift, 'overlap_words': len(pairs), 'bit_error_rate': sum((x ^ y).bit_count() for x, y in pairs) / (32 * len(pairs))})
print(json.dumps({'scope': 'sample consistency; recording provenance must be independently established', 'reference_provenance': a.reference_provenance, 'samples': samples, 'exact_pcm_match': samples[0]['pcm_sha256'] == samples[1]['pcm_sha256'], 'algorithm': 'Chromaprint algorithm 1', 'fingerprint_lengths': list(map(len, fingerprints)), 'best_alignment': min(comparisons, key=lambda x: x['bit_error_rate']), 'limitation': 'No calibrated fuzzy-match threshold or full-track/Discord claim. Same-source comparison cannot independently prove original/master/version.'}, indent=2))
