/* Buck Ledger settings: the only file you need to edit to launch paid tiers.
 *
 * TIERS (all one-time purchases on Gumroad, no subscription):
 *   Free  : FREE_CAMERA_LIMIT cameras, FREE_BUCK_LIMIT named bucks, FREE_PRED_LIMIT prediction (+ its scored result)
 *   Pro   : PRO_CAMERA_LIMIT cameras, PRO_BUCK_LIMIT named bucks, PRO_OPEN_PRED_LIMIT open predictions at a time  (PRO_PRICE)
 *   Elite : unlimited cameras, bucks + predictions, plus the 2D Movement Simulator and the 3D Terrain Sim     (ELITE_PRICE)
 *   Every tier: state rut/acorn research, sun + moon per visit, weather per visit, ribbon temp, headings, bait log,
 *               points + small-buck filter, rename history, profile photo, companions, buck ID suggestions, 3D demo.
 *   Elite Upgrade : Pro owners pay the difference (UPGRADE_PRICE). Its key only unlocks Elite on a phone
 *                   that already holds a valid Pro key; both keys are re-checked with Gumroad.
 *
 * >>> ALL PRODUCT IDS AND CHECKOUT LINKS ARE EMPTY ON PURPOSE. NOT SET YET. NEVER GUESS THEM. <<<
 *   While empty, the app runs in Free mode and the buy buttons say "coming soon". Nothing breaks.
 *
 * OPTION A (recommended): ONE Gumroad product with three versions named exactly
 *   "Pro" ($30), "Elite" ($50), "Elite Upgrade" ($20), with "Generate a unique license key per sale" on.
 *   Paste its product_id into GUMROAD_PRODUCT_ID and its link into CHECKOUT_URL.
 *   The app reads the version from Gumroad's verify reply (purchase.variants).
 * OPTION B (fallback): three separate products. Fill PRO_/ELITE_/UPGRADE_PRODUCT_ID and the matching
 *   *_CHECKOUT_URL instead (leave GUMROAD_PRODUCT_ID empty).
 * After editing: bump VERSION in sw.js and publish.
 *
 * License keys are verified ONCE online with Gumroad, then keep working on the phone. Refunded / charged-back /
 *   disabled keys are refused, and (when online) re-checked every RECHECK_DAYS.
 * DEV_MODE: keep false in production. When true, the code BUCKLEDGER-TEST unlocks Elite for testing.
 */
window.BUCKLEDGER_CONFIG = {
  APP_NAME: "Buck Ledger",
  PRO_PRICE: "$30",
  ELITE_PRICE: "$50",
  UPGRADE_PRICE: "$20",
  PRO_PRICE_NOTE: "One-time purchase. No subscription.",

  // Option A: one product with versions "Pro", "Elite", "Elite Upgrade"
  GUMROAD_PRODUCT_ID: "",        // <<< SET THIS (from Gumroad). Do not guess.
  CHECKOUT_URL: "",              // <<< SET THIS: the product link, e.g. https://sladepatterson.gumroad.com/l/xxxxx

  // Option B (fallback): separate products. Leave empty if you use Option A.
  PRO_PRODUCT_ID: "",            // <<< not set
  ELITE_PRODUCT_ID: "",          // <<< not set
  UPGRADE_PRODUCT_ID: "",        // <<< not set
  PRO_CHECKOUT_URL: "",          // <<< not set (Option A: optional direct link to the Pro version)
  ELITE_CHECKOUT_URL: "",        // <<< not set
  UPGRADE_CHECKOUT_URL: "",      // <<< not set

  LICENSE_VERIFY_URL: "https://api.gumroad.com/v2/licenses/verify", // Gumroad allows browser (CORS) calls
  MAX_ACTIVATIONS: 5,
  RECHECK_DAYS: 30,
  FREE_CAMERA_LIMIT: 1,          // confirmed by Slade
  FREE_BUCK_LIMIT: 1,            // confirmed by Slade
  PRO_CAMERA_LIMIT: 3,           // confirmed by Slade
  PRO_BUCK_LIMIT: 3,             // confirmed by Slade
  FREE_PRED_LIMIT: 1,            // Slade: Free = ONE prediction + ONE scored result
  PRO_OPEN_PRED_LIMIT: 5,        // DECISION FOR SLADE: Pro = up to 5 open (unscored) predictions at a time; scored ones don't count

  DEV_MODE: false,
  DEV_UNLOCK_CODE_SHA256: [
    "3a54c6c7e655155426c791d8e7fe1255f1d3241247f96e7754aea9d0109608e0" // BUCKLEDGER-TEST (only works when DEV_MODE is true)
  ]
};
