# Buck Ledger

A hunter's trail cam logbook that fills itself in from your SD card. Phone web app (PWA): no account, no subscription, and photos never leave the phone.

Live: https://pattersonslade-rgb.github.io/buckledger/

Tiers (one-time, via Gumroad): Free (1 camera, 1 named buck, 1 prediction) · Pro $30 (3 / 3, 3 open predictions) · Elite $50 (unlimited + 2D Movement Simulator + 3D Terrain Sim) · Elite Upgrade $20 for Pro owners.

v3 adds: state picker with rut/acorn/drought/crop info (`data/states.js`), sun + moon per visit, hourly weather per visit (Open-Meteo, on a tap), ribbon temp (typed or read on the phone with the self-hosted OCR in `vendor/ocr`), travel headings, bait log, points + small-buck filter, rename history, profile photos, companions, conservative buck ID suggestions, sha256-locked predictions scored hit/miss, and the 3D Terrain Sim (`terrain.js`, USGS 3DEP elevation on a tap).

To launch paid tiers, fill the product IDs and checkout links in `config.js` (instructions at the top of that file), bump VERSION in `sw.js`, and push.

The Simulator (Elite) runs one engine (`terrain.js`) in the phone for the buyer's own property, shown as a 2D map (`sim.js`, which also holds the map editor) or 3D terrain: USGS 3DEP elevation and Open-Meteo hourly weather on a tap (on the property's own clock), wind with its published wavering spread, slope air, scent, deer routes worked out from the buyer's bedding and food marks, green/yellow/red stands with plain reasons, and the safest walk-in. No numbers, graphs or trail-cam photos in the view. It is a model, not a forecast. The Example property (`data/example.js`) is a drawn layout with relative heights only.
