## Signal Chain section (index.html `#chain`)

Append this section to your existing `PARAMETERS.md`.

| Parameter | File | Default | What it does |
|---|---|---|---|
| `CHAIN_STOPS` | `index.html` (`<ol class="chain-stops">`) | 6 cards | Text and project links for each stop. Keep 6 cards in this order: intro, Ingest, QC, Playout, Delivery, final. |
| `--chain-length` | `assets/css/signal-chain.css` | `340vh` | How much scrolling the section takes. Lower = faster, less "trapped" on phones. |
| `--stage-bg` | `assets/css/signal-chain.css` | `#0D1118` | Stage background. Must match `STAGE_COLOR`. |
| `STAGE_COLOR` | `assets/js/signal-chain.js` `CONFIG` | `0x0D1118` | 3D scene background. Must match `--stage-bg`. |
| `CAMERA_KEYS` | `assets/js/signal-chain.js` `CONFIG` | 6 keys | Camera position per card: `t` scroll position 0–1, `az` azimuth °, `el` elevation °, `dist` distance, `ty` look-at height (rack runs 0–4.4). |
| `HOLD` | `assets/js/signal-chain.js` `CONFIG` | `0.045` | How long the camera rests at each stop. |
| `SCRUB_SMOOTHING` | `assets/js/signal-chain.js` `CONFIG` | `0.5` | Seconds of lag between scroll and camera. 0 = locked to the scrollbar. |
| `FOV` | `assets/js/signal-chain.js` `CONFIG` | `30` | Camera field of view in degrees. |
| `SHIFT_WIDE` / `SHIFT_TALL` | `assets/js/signal-chain.js` `CONFIG` | `0.15` / `0.17` | How far the rack is pushed away from the card (right on wide screens, up on tall ones). |
| `MAX_DPR` | `assets/js/signal-chain.js` `CONFIG` | `1.75` | Pixel-density cap. Lower = cooler and faster on phones. |
| `IDLE_TIMEOUT` | `assets/js/signal-chain.js` `CONFIG` | `2500` | The 3D loads once the page has loaded and the browser is idle. This is the longest it waits for idle (ms) before loading anyway. |
| `PRELOAD_MARGIN` | `assets/js/signal-chain.js` `CONFIG` | `1500px 0px` | If a visitor gets this close to the section before the idle load starts (e.g. via the nav link), loading starts at once. |
| `CHAIN_POSTERS` | `assets/css/signal-chain.css` (`--poster-wide`, `--poster-tall`) | `assets/img/signal-chain-poster-*.webp` | Still of the opening shot shown in the stage until the 3D's first frame. Re-capture if you change the rack or `CAMERA_KEYS[0]`. |
| `ZONE_NAMES` | `assets/js/signal-chain.js` `CONFIG` | Ingest, QC, Playout, Delivery | Stage names shown in the stage readout. |
| `LED` | `assets/js/signal-chain.js` `CONFIG` | idle / amber / green | Zone light colours for waiting, active and completed stages. |
| `LAYOUT` | `assets/js/signal-chain.js` `buildRack()` | 20 devices | Rack contents top to bottom: `[zone, rack units, kind]`. Kinds: ird, encoder, fiber, server, ccmon, mv, scope, router, recorder, switch, blank. |
| `VENDOR_THREE` / `VENDOR_GSAP` | `assets/js/signal-chain.js` `CONFIG` | `assets/vendor/…` | Paths to the self-hosted libraries. |

### Self-hosted libraries (`assets/vendor/`)

- `three.min.js` — three.js r128 (MIT, see `three.LICENSE.txt`)
- `gsap.min.js`, `ScrollTrigger.min.js` — GSAP 3.12.5 (GreenSock standard licence, free for this use; licence header kept in each file)

### Debug mode

Add `?chaindebug` to the page URL to show a frame counter, scroll position, stop, scroll driver and GPU name inside the stage. Add `?chaindebug=raw` to also bypass GSAP so the camera follows the scrollbar directly. If the frame counter climbs while the rack image stays still, the phone is drawing frames but not displaying them.

The section falls back to a plain card grid when WebGL is unavailable, reduced motion is on, a library fails to load, or the page is printed.
