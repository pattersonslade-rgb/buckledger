# Buck Ledger

A hunter's trail cam logbook that fills itself in from your SD card. Phone web app (PWA): no account, no subscription, and photos never leave the phone.

Live: https://pattersonslade-rgb.github.io/buckledger/

Tiers (one-time, via Gumroad): Free (1 camera, 1 named buck, 1 prediction) · Pro $30 (3 / 3, 5 open predictions) · Elite $50 (unlimited + 2D Movement Simulator + 3D Terrain Sim) · Elite Upgrade $20 for Pro owners.

v3 adds: state picker with rut/acorn/drought/crop info (`data/states.js`), sun + moon per visit, hourly weather per visit (Open-Meteo, on a tap), ribbon temp (typed or read on the phone with the self-hosted OCR in `vendor/ocr`), travel headings, bait log, points + small-buck filter, rename history, profile photos, companions, conservative buck ID suggestions, sha256-locked predictions scored hit/miss, and the 3D Terrain Sim (`terrain.js`, USGS 3DEP elevation on a tap).

To launch paid tiers, fill the product IDs and checkout links in `config.js` (instructions at the top of that file), bump VERSION in `sw.js`, and push.

The Movement Simulator (`sim.js`) is a simple relative-odds model built from published whitetail GPS-collar research plus labeled assumptions. It is not a forecast.
