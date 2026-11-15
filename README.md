# Dive Moore Conditions

A dive-slate web app for 74 Big Island dive sites (shore and boat). For each site it shows waves, swell, wind, tide, water temperature, current and weather alerts, and gives a go / caution / no-go call. It also has a flying-after-diving planner and site details (entry, exit, route, hazards, parking).

- **Live version:** https://claude.ai/artifact/MWKaZUjEGCeec9N5baDf5m (this version also has the shared diver reports)
- **Code:** https://github.com/moorejohnedward/Dive-Moore-Site-Guide
- **Offline copy:** `index.html` in this folder. Double-click it to open in a browser. Everything works except diver reports and corrections, which need the live version's shared database.

## The APIs it uses

The app calls six free public APIs. None of them needs an API key. Every call is an HTTP **GET** with the settings in the **query string**, and every answer comes back as **JSON**.

| # | What the app shows | API | Endpoint |
|---|---|---|---|
| 1 | Wave height, swell, period | Open-Meteo Marine | `marine-api.open-meteo.com/v1/marine` |
| 2 | Sea temp, current | Open-Meteo Marine | same endpoint, different `hourly` fields |
| 3 | Wind, gusts, rain (runoff) | Open-Meteo Forecast | `api.open-meteo.com/v1/forecast` |
| 4 | High and low tides | NOAA CO-OPS | `api.tidesandcurrents.noaa.gov/api/prod/datagetter` |
| 5 | Water temp at the gauge | NOAA CO-OPS | same endpoint, `product=water_temperature` |
| 6 | Watches and warnings | National Weather Service | `api.weather.gov/alerts/active` |

Tide stations: Kawaihae `1617433` (west side), Hilo `1617760` (east side).

## Try them in Hoppscotch

1. Open Hoppscotch (hoppscotch.io or the desktop app).
2. Collections → Import → **Hoppscotch** → choose `Dive Moore Conditions.hoppscotch.json`.
3. Open any request and click **Send**. All six are set to Two Step and Kawaihae.
4. Click **Test Results** to see the pass/fail checks in each request's **Tests** tab.

Things to try:

- **Change one parameter and resend.** Swap `station` to `1617760` (Hilo), or move the latitude and longitude to another site.
- **Break it on purpose.** Set `product=tides` (not a real NOAA product). NOAA still answers **200 OK** but puts an `error` in the body. That's why request 4's test checks the body as well as the status code.
- **Turn a parameter off** with its checkbox. Turn off `length_unit` in request 1 to see meters, which is what the app receives and converts itself.
- **Look at the headers.** Request 6 sends a `User-Agent`, because the Weather Service asks every caller to say who they are.

## How the app uses the answers (in `index.html`)

- `getJSON(url)`: one helper does every call. It gives up after 15 seconds (AbortController) and throws if the status isn't OK.
- `loadAll()`: fires all the calls together with `Promise.all`, then runs again every 30 minutes.
- `seaPoint()`: moves each site about 1.1 mi offshore before asking for wave data, so the wave model treats the point as ocean and not land.
- The app asks several weather models for the same hour, averages them, and shows how far apart they are. When the models disagree, the forecast is less certain.

## Files

- `index.html` — the app (one self-contained file)
- `Dive Moore Conditions.hoppscotch.json` — the six API calls, ready to import into Hoppscotch
- `README.md` — this file
