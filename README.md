# Passau Go

Arabic/English transit planner for Passau. Public app: https://ahmed4r.github.io/passau_go/

## Map

- Open **Map**, select **A**, then select **B**. Click the map, use a stop popup, or choose a stop from the searchable list below the map.
- **Find route from A to B** requests bus connections departing now. Choose a returned connection to draw its route and walking sections.
- **View route in app** on an existing journey opens that specific itinerary on the map, including journeys planned for a later time.
- Enable **Show estimated buses** to display active bus segments in the visible area. Marker positions interpolate along provider geometry using departure/arrival times. **These are not GPS locations.** Updated times, when available, improve timing but do not establish an actual vehicle position.
- Map times refresh every minute while the map is visible. Updates pause when leaving the map or hiding the page. Failed or expired data removes markers. Empty overnight service is shown as an empty state.
- Routes without provider geometry use dashed, explicitly labelled straight-line approximations.

The app uses Leaflet 1.9.4, OpenStreetMap tiles, and the Transitous MOTIS v6 API. Browser requests send the site referrer. Provider attribution and source/contact links are in the Map footer. Genuine GPS tracking requires a suitable operator vehicle-position feed; none is configured.

## Local development

Serve this folder with a static HTTP server (for example `python -m http.server 8080`). No production build or npm dependencies are required. GitHub Pages serves `index.html`, `map-core.js`, and `transit-map.js` from `main`.

## Checks

```sh
npm ci
npm test
```

For DOM integration tests with the real Leaflet library and a local HTTP simulation, start this command in one terminal:

```sh
postman simulation run postman/simulations/transit-map.sim.yaml --port 4317 --no-history --output ndjson
```

Then run `npm run test:map` in another. This checks application initialization, stop and coordinate selection, route rendering, bus estimates, response races, empty responses, outages, and RTL labels. It does not establish visual browser layout or real vehicle accuracy. Fixtures follow the provider contract; the mock's `/__control` endpoint is local test infrastructure only.

## API references

- https://transitous.org/api/
- https://github.com/motis-project/motis/blob/master/openapi.yaml
- `postman/specs/transit-map.openapi.yaml` records the dependency subset.
