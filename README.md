# FH6 Ultimate Tuner V19.1

Open `index.html` locally or deploy the extracted files as a static website. The ZIP contains the same source files.

## Red team fixes

- Saved car names and result rows are inserted as text, preventing HTML or script injection from a malicious car name or damaged browser storage.
- Horsepower, torque, weight, front weight, year, and gear count are checked before generating.
- Corrupt or unavailable browser storage no longer stops the tuner at startup or silently overwrites prior saves.
- The service worker only removes this app's older caches.

## Limits

Tune suggestions and performance estimates are heuristic. They are not validated FH6 telemetry. Torque is collected but not used in the formula. Saves live only in this browser's local storage; clearing site data removes them.
