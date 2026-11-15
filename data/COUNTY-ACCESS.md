# County public access cross-reference

The County of Hawaiʻi Planning Department publishes a shoreline public access guide by district:
https://www.planning.hawaiicounty.gov/resources/shoreline-public-access

Each county access was checked against published diving and snorkeling activity (dive shop shore-site lists, shore-dive reviews, state MLCD pages). Accesses with real diving use became sites in the app. Sites tagged **Public access** in the app carry a `county` field in `data/sites.js`.

## New sites added from the county list (`verify: true`)

These show a **New** tag and a "scout it before you dive it" notice until the entry, route and GPS are confirmed in person. To confirm one, fix anything that's wrong in `data/sites.js` and delete its `"verify":true`.

| Site | District · county map | Diving activity found |
|---|---|---|
| ʻAlula Beach (Honokōhau shore) | North Kona · Map 2 | Shore-dive reviews ("Alua Beach"); listed as a snorkel and scuba beach |
| Kikaʻua Point Park (Kūkiʻo) | North Kona · Map 1 | Sheltered lagoon snorkel; calm-day reef outside the point |
| Magic Sands (Laʻaloa Beach Park) | North Kona · Map 5 | Rocky cove south of the point used for scuba; dive shop shore-site list |
| Keauhou Bay (shore) | North Kona · Map 6 | Dive shop shore-site list |
| Manini Beach (Kealakekua Bay south) | South Kona · Map 2 | Dive shop shore-site list |
| Miloliʻi Beach Park | South Kona · Map 4 | Big Island dive map (6–65 ft) |
| Holoholokai Beach Park | South Kohala · Map 3 | Common Kohala shore dive |
| ʻAnaehoʻomalu Bay (A-Bay shore) | South Kohala · Map 3 | Listed for swim, dive, snorkel |
| Kaunaʻoa Beach (Mauna Kea Beach) | South Kohala · Map 2 | Point reefs snorkeled and dived on calm days |
| Kapaʻa Beach Park (North Kohala) | North Kohala | Snorkeling and diving when calm (no swimming beach) |
| Lapakahi (Koaiʻe Cove) | North Kohala | Lapakahi MLCD (state DAR) |
| Carlsmith Beach Park (Four Mile) | South Hilo · Map 7 | Lagoon snorkel and training |
| Pohoiki (Isaac Hale Beach Park) | Puna · Map 2 | Long rated best shore dive in East Hawaiʻi; shoreline changed in 2018 |

## Existing sites that sit on a county access

Old Kona Airport, Old Airport North, Kailua Pier, Mile Marker 4, Kahaluʻu, Two Step (Hōnaunau Bay boat ramp), Hoʻokena, Puakō Reef, Puakō End of the Road, Waialea Bay, Hāpuna, Spencer, Mahukona, Richardson, Leleiwi.

## Still to do

- The county's GIS server doesn't allow automated reading, and the brochure's individual entries sit inside collapsible sections. The full point-by-point county list (every numbered access, such as the 12 along Puakō Beach Drive) still needs to be pulled from the county pages in a browser and checked against this table.
- GPS for the new sites is approximate. Confirm each one on site.
