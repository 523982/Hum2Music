# Hum2Music V3 Recording Fix

This build is deliberately self-contained in `index.html`.

The Start Recording control has:
- direct click handler
- iPhone touch/pointer fallback
- microphone permission diagnostics
- no external JavaScript
- no modules
- no WASM
- no external libraries

Replace the existing root `index.html` with this file.
