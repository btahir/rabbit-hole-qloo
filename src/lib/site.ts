/** Public origin for absolute metadata URLs. ShipTiffin provides TIFFIN_URL at build and run time. */
export function siteOrigin() {
  return (
    process.env.APP_ORIGIN || process.env.TIFFIN_URL || "http://localhost:3000"
  );
}
export const siteDescription =
  "Start with a film, musician or book you love. Qloo taste data and an AI guide find three discoveries in other media. Send the trail to a friend.";
