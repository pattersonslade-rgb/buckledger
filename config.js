/* Buck Ledger settings: the only file you need to edit to launch Pro.
 *
 * >>> GUMROAD_PRODUCT_ID and CHECKOUT_URL are NOT SET YET (left empty on purpose). <<<
 *   Slade: create the Gumroad product, tick "Generate a unique license key per sale",
 *   then paste the product_id Gumroad shows into GUMROAD_PRODUCT_ID and the product link
 *   into CHECKOUT_URL, bump VERSION in sw.js and redeploy.
 *   While they are empty the app runs in FREE mode and the Pro button says "coming soon".
 * PRO_PRICE: wording shown in the app (empty = no price shown).
 * FREE_CAMERA_LIMIT / FREE_BUCK_LIMIT: what the free version allows (0 = unlimited).
 * License keys are verified ONCE online with Gumroad, then Pro works offline. Refunded /
 *   charged-back / disabled keys are refused, and (when online) re-checked every RECHECK_DAYS.
 * Support and refunds go through Gumroad only.
 * DEV_MODE: keep false in production. When true, the code BUCKLEDGER-TEST also unlocks.
 */
window.BUCKLEDGER_CONFIG = {
  APP_NAME: "Buck Ledger",
  PRO_PRICE: "",                  // e.g. "$9.99" once Slade picks the price
  PRO_PRICE_NOTE: "One-time purchase. No subscription.",
  CHECKOUT_URL: "",               // <<< SET THIS: Gumroad product link
  GUMROAD_PRODUCT_ID: "",         // <<< SET THIS: product_id from Gumroad. Never guess it.
  LICENSE_VERIFY_URL: "https://api.gumroad.com/v2/licenses/verify", // Gumroad allows browser (CORS) calls
  MAX_ACTIVATIONS: 5,
  RECHECK_DAYS: 30,
  FREE_CAMERA_LIMIT: 1,           // free tier (confirmed by Slade): 1 camera
  FREE_BUCK_LIMIT: 1,             // free tier (confirmed by Slade): 1 named buck

  DEV_MODE: false,
  DEV_UNLOCK_CODE_SHA256: [
    "3a54c6c7e655155426c791d8e7fe1255f1d3241247f96e7754aea9d0109608e0" // BUCKLEDGER-TEST (only works when DEV_MODE is true)
  ]
};
