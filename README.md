# Hum2Music V3 Fixed

This version removes the external Essentia.js/WASM dependency that caused the
page to remain stuck on "Loading engine..." and prevented recording.

It uses a browser-local autocorrelation pitch detector.

Features:
- Original Timing
- Quantized Timing
- Note repetitions
- Natural gaps
- Note durations
- Piano-roll timing view
- Playback
- MIDI export
- No backend or API key
- GitHub Pages and mobile-browser compatible
