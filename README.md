# Buck Ledger

A hunter's trail cam logbook that fills itself in from your SD card. Phone web app (PWA): no account, no subscription, works offline, and photos never leave the phone.

Live: https://pattersonslade-rgb.github.io/buckledger/

Tiers (one-time, via Gumroad): Free (1 camera, 1 named buck) · Pro $30 (3 / 3) · Elite $50 (unlimited + Movement Simulator) · Elite Upgrade $20 for Pro owners.

To launch paid tiers, fill the product IDs and checkout links in `config.js` (instructions at the top of that file), bump VERSION in `sw.js`, and push.

The Movement Simulator (`sim.js`) is a simple relative-odds model built from published whitetail GPS-collar research plus labeled assumptions. It is not a forecast.
