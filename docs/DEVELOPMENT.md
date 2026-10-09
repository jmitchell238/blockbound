# Development

## Running locally

The game uses ES modules, which don't load from `file://`, so serve the folder:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080.

## Tests

```bash
npm test
```

This runs `node tests/run.mjs`.

## Versioning

`GAME_VERSION` lives in `js/core/constants.js`. When you bump it, set `CACHE` in `sw-bb.js` to `'blockbound-' + GAME_VERSION`. The tests check that they match.

`sw-bb.js` is the service worker for new installs. `sw.js` only exists to move older installs that are stuck on it over to `update.html`.

## Other docs

- [ARCHITECTURE.md](ARCHITECTURE.md): layers, world model, frame order, rendering, save format
- [ROADMAP.md](ROADMAP.md): planned cleanups and feature ideas
- [handbook.html](handbook.html): both of the above on one page, for reading in a browser
