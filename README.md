# Dive Moore Conditions

A phone app for 87 Big Island dive sites (shore and boat). For each site it shows waves, swell, wind, tide, water temperature, current and weather alerts, and gives a Good / Caution / No-go call. It also has entry difficulty for today, a flying-after-diving planner, and site details: entry, exit, route, hazards, parking and emergency contacts.

- **App:** https://moorejohnedward.github.io/Dive-Moore-Site-Guide/ (once GitHub Pages is on)
- **Code:** https://github.com/moorejohnedward/Dive-Moore-Site-Guide

## What makes it an app

- **Installs on a phone.** Open the link and use "Add to Home Screen" (iPhone) or the **Install app** button (Android, Chrome, Edge). It opens full screen with its own icon.
- **Works with no signal.** A service worker (`sw.js`) keeps the app on the device. The last conditions download is saved for 36 hours, so at the dive site you still see what it said before you lost signal, clearly marked as offline.
- **Never shows made-up conditions.** If the feeds can't be reached and there's no recent download, it says so. Example data only appears in test mode (`?demo=1` at the end of the address).
- **County public access.** 28 sites are on the County of Hawaiʻi shoreline public access list and carry a **Public access** tag and filter. 13 of them were added from that list and are tagged **New** until they're checked in person. See `data/COUNTY-ACCESS.md`.

## Files

| Path | What it is |
|---|---|
| `index.html` | The page |
| `css/app.css` | Look and layout |
| `js/app.js` | The app: loads conditions, rates sites, draws every screen |
| `js/install.js` | Offline support and the Install button |
| `data/sites.js` | All dive sites, emergency contacts, tide stations and altitude routes. **Edit sites here.** |
| `data/COUNTY-ACCESS.md` | How the county access list was matched to dive sites |
| `sw.js` | Service worker (offline) |
| `manifest.webmanifest`, `icons/` | App name, colors and icons for installing |
| `Dive Moore Conditions.hoppscotch.json` | The app's six API calls for Hoppscotch |

After changing any file, bump `VERSION` in `sw.js` (for example `dm-v2`) so installed copies pick up the change.

## The APIs it uses

Six free public APIs, no keys. Every call is an HTTP **GET** with the settings in the query string, and every answer is **JSON**.

| # | What the app shows | API | Endpoint |
|---|---|---|---|
| 1 | Wave height, swell, period | Open-Meteo Marine | `marine-api.open-meteo.com/v1/marine` |
| 2 | Sea temp, current | Open-Meteo Marine | same endpoint, different `hourly` fields |
| 3 | Wind, gusts, rain (runoff) | Open-Meteo Forecast | `api.open-meteo.com/v1/forecast` |
| 4 | High and low tides | NOAA CO-OPS | `api.tidesandcurrents.noaa.gov/api/prod/datagetter` |
| 5 | Water temp at the gauge | NOAA CO-OPS | same endpoint, `product=water_temperature` |
| 6 | Watches and warnings | National Weather Service | `api.weather.gov/alerts/active` |

Tide stations: Kawaihae `1617433` (west side), Hilo `1617760` (east side).

### Try them in Hoppscotch

1. Open Hoppscotch (hoppscotch.io or the desktop app).
2. Collections → Import → **Hoppscotch** → choose `Dive Moore Conditions.hoppscotch.json`.
3. Open any request and click **Send**. All six are set to Two Step and Kawaihae.
4. Click **Test Results** to see the pass/fail checks in each request's **Tests** tab.

Things to try: swap `station` to `1617760` (Hilo); set `product=tides` (not a real product) and notice NOAA still answers 200 with an `error` in the body; turn off `length_unit` in request 1 to see meters; look at the `User-Agent` header on request 6.

### How the app uses the answers (`js/app.js`)

- `getJSON(url)` does every call, gives up after 15 seconds, and throws if the status isn't OK.
- `loadAll()` fires all calls together with `Promise.allSettled`, saves a good result for offline use, and runs again every 30 minutes.
- `seaPoint()` moves each site about 1.1 mi offshore before asking for wave data, so the wave model treats the point as ocean.
- Several weather models are averaged for the same hour, and the app shows how far apart they are. When models disagree, the forecast is less certain.

## Not done yet

- **Diver reports and site corrections** worked through a shared database in the Claude-hosted version. This version shows a "coming soon" note until it has its own database.
- **New sites need checking in person** (entry spot, route, GPS).
- **Full county access list**: see `data/COUNTY-ACCESS.md`.
