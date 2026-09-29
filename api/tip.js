// Retired: this old endpoint trusted amounts sent from the browser.
// All payments now go through /api/pay (see api/pay.js). Safe to delete this file.
export default function handler(req, res) {
  res.statusCode = 410;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: "This endpoint was retired. Update the app." }));
}
