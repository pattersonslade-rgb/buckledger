# WIP: rebuild sim on the BL1 (HBK) sim approach — NOT STARTED IN CODE
Status: only study done. No app code changed on this branch.
Studied: hbk-sim/build/precompute.js, hbk-sim/src/app.js (outline), hbk-build/src/04_physics.js + 05_engine.js (API), hbk-sim2d/build (data.json keys, build_data.py).
Plan notes:
- 04_physics.js / 05_engine.js are pure (global PHYS/ENG, no DOM): can ship as-is in the browser. fetchWx hard-codes America/Chicago; needs a timezone param for other buyers.
- Port precompute.js per-day loop to the browser: metRecord -> runSlope -> hourCtx/velocity field, members('field') + pathFor plumes, standExposure vs bed receptors, walkExposure for walk-ins, sev() 0.5/0.15 levels.
- 3D: three.js renderer from hbk-sim/src/app.js reading that per-day object instead of HBK_STATIC/HBK_DAYS files.
- 2D: hbk-sim2d/build/template.html + data.json shape; routes there are precomputed by Python (predicted_routes) — must be computed client-side for buyer maps.
- Example property (allowed per Slade 8:30): HBK layout/terrain/bucks/visits in relative metres only. Must scrub: lat/lng, overlay_bounds, county, "HBK", road names (e.g. in parking/bedding notes), camera names containing HBK, EXIF, NAIP aerial (img_aerial) — keep relative hillshade only.
- Unsourced values seen so far to list: precompute FS 0.04 field quantisation (display), poolF display scaling (labeled display), sev() thresholds 0.5/0.15, route "solid" 40 m camera radius, WIN 0.75 h route lit window, EXAG 5 / AIRZ 2.2 / VIS 16 display scales, offShare 0.6, 500 m / 150 m plume windows.
