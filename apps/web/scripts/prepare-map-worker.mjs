import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// MapLibre 6's ESM worker imports its shared sibling. Next's asset bundling
// does not emit that sibling; serve both from the installed package together.
// https://github.com/maplibre/maplibre-gl-js/pull/8128
const require = createRequire(import.meta.url);
const source = join(dirname(require.resolve("maplibre-gl/package.json")), "dist");
const destination = fileURLToPath(new URL("../public/maplibre/", import.meta.url));
await mkdir(destination, { recursive: true });
await Promise.all(["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"].map((file) => copyFile(join(source, file), join(destination, file))));
