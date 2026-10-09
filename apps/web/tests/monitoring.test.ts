import assert from "node:assert/strict";
import { test } from "node:test";
import { backendResponse } from "../src/lib/backend-api";
import { DEMO_QUERY, runDemoQuery } from "../src/lib/demo-monitoring";
import { observationDate, observationTime, validateQuery } from "../src/lib/monitoring";
import { resolveRoadGeometry, validateRoadPoints } from "../src/lib/road-routing";

test("Colombian timestamps match UTC, including naive SQLite values", () => {
  assert.equal(observationTime("2026-08-25T14:30:00"), "09:30:00");
  assert.equal(observationTime("2026-08-25T14:30:00Z"), "09:30:00");
  assert.equal(observationTime("2026-08-25T09:30:00-05:00"), "09:30:00");
  assert.equal(observationDate("2026-08-26T03:30:00"), "2026-08-25");
});

test("invalid windows, coordinates, radius and unzoned times are rejected", () => {
  for (const change of [{ time_to: DEMO_QUERY.time_from }, { time_from: "2026-08-25T09:20:00" }, { lat: NaN }, { lng: 181 }, { radius_m: -1 }, { radius_m: 50001 }, { color: 14 }, { vehicle_type: "truck" }]) {
    assert.throws(() => validateQuery({ ...DEMO_QUERY, ...change }));
  }
});

test("demo search respects geographic, temporal and appearance filters", () => {
  assert.equal(runDemoQuery(DEMO_QUERY).routes.length, 2);
  const nearby = runDemoQuery({ ...DEMO_QUERY, radius_m: 100 });
  assert.equal(nearby.nearby_devices.length, 1);
  assert.equal(nearby.candidate_detection_count, 1);
  assert.equal(nearby.routes.length, 0);
  assert.equal(runDemoQuery({ ...DEMO_QUERY, color: "red" }).candidate_detection_count, 0);
  assert.equal(runDemoQuery({ ...DEMO_QUERY, time_to: "2026-08-25T09:25:00-05:00" }).candidate_detection_count, 0);
  const motorcycle = runDemoQuery({ ...DEMO_QUERY, color: "black", vehicle_type: "motorcycle" });
  assert.equal(motorcycle.routes[0].camera_ids.length, 4);
});

test("proxy normalizes Colombian hours to UTC before SQLite compares observations", async (context) => {
  let requested = "";
  context.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    requested = url;
    assert.equal(init.cache, "no-store");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer session-token");
    return Response.json({ routes: [] });
  });
  const response = await backendResponse("/queries", { ...DEMO_QUERY, arbitrary: "discard" }, "session-token");
  const url = new URL(requested);
  assert.equal(url.pathname, "/api/v1/queries");
  assert.equal(url.searchParams.get("time_from"), "2026-08-25T14:20:00.000Z");
  assert.equal(url.searchParams.get("time_to"), "2026-08-25T15:30:00.000Z");
  assert.equal(url.searchParams.get("radius_m"), "2000");
  assert.equal(url.searchParams.has("arbitrary"), false);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.status, 200);
});

test("proxy validates before contacting backend and reports outages as 503", async (context) => {
  let called = false;
  context.mock.method(globalThis, "fetch", async () => { called = true; throw new Error("private upstream address"); });
  assert.equal((await backendResponse("/queries", {}, "session-token")).status, 400);
  assert.equal(called, false);
  const unavailable = await backendResponse("/devices", undefined, "session-token");
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.text()).includes("private upstream"), false);
});

test("backend rejection is surfaced rather than replaced with demo results", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("internal trace", { status: 500 }));
  const result = await backendResponse("/queries", DEMO_QUERY, "session-token");
  assert.equal(result.status, 502);
  assert.equal((await result.json()).routes, undefined);
});

test("proxy refuses anonymous calls locally and maps backend auth errors", async (context) => {
  let called = false;
  context.mock.method(globalThis, "fetch", async () => { called = true; return new Response(null, { status: 403 }); });
  assert.equal((await backendResponse("/devices")).status, 401);
  assert.equal(called, false);
  const forbidden = await backendResponse("/devices", undefined, "session-token");
  assert.equal(forbidden.status, 403);
  assert.match((await forbidden.json()).error, /rol/);
  context.mock.method(globalThis, "fetch", async () => new Response(null, { status: 401 }));
  assert.equal((await backendResponse("/queries", DEMO_QUERY, "expired")).status, 401);
});

test("road geometry follows OSRM coordinates and rejects invalid camera sequences", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({ routes: [{ distance: 812.4, geometry: { coordinates: [[-74.8172, 11.0131], [-74.816, 11.0125], [-74.8148, 11.011]] } }] }));
  const geometry = await resolveRoadGeometry([{ lng: -74.8172, lat: 11.0131 }, { lng: -74.8148, lat: 11.011 }]);
  assert.equal(geometry.source, "road-network");
  assert.equal(geometry.points.length, 3);
  assert.equal(geometry.distance_m, 812.4);
  assert.throws(() => validateRoadPoints([{ lng: -74.8, lat: 11 }]));
});

test("road geometry keeps an explicit straight-line fallback when routing is unavailable", async (context) => {
  context.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  const points = [{ lng: -74.8172, lat: 11.0131 }, { lng: -74.8148, lat: 11.011 }];
  const geometry = await resolveRoadGeometry(points);
  assert.equal(geometry.source, "camera-chord");
  assert.deepEqual(geometry.points, points);
});

test("unconfigured routing uses the local service and never the public demo", async (context) => {
  const previous = process.env.ROAD_ROUTER_URL;
  delete process.env.ROAD_ROUTER_URL;
  let requested = "";
  context.mock.method(globalThis, "fetch", async (url: string) => { requested = String(url); throw new Error("local unavailable"); });
  try {
    const geometry = await resolveRoadGeometry([{ lng: -74.8172, lat: 11.0131 }, { lng: -74.8148, lat: 11.011 }]);
    assert.equal(new URL(requested).origin, "http://127.0.0.1:5000");
    assert.equal(geometry.source, "camera-chord");
  } finally {
    if (previous === undefined) delete process.env.ROAD_ROUTER_URL;
    else process.env.ROAD_ROUTER_URL = previous;
  }
});
