import { expect, test } from "@playwright/test";
import { DEMO_DEVICES, DEMO_QUERY, runDemoQuery } from "../../src/lib/demo-monitoring";

const OPERATOR = { id: "00000000-0000-4000-8000-000000000001", email: "ana@vigia.test", display_name: "Ana Operadora", role: "operator" };

async function signedIn(page: import("@playwright/test").Page) {
  await page.unroute("**/api/auth/session");
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { user: OPERATOR, expires_at: "2026-10-09T08:00:00Z" } }));
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ status: 401, json: { error: "Sin sesión." } }));
  await page.route("**/api/monitoring/devices", (route) => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.route("**/api/monitoring/route-geometry", async (route) => {
    const points = route.request().postDataJSON().points;
    await route.fulfill({ json: { points, source: "road-network", distance_m: 812.4 } });
  });
});

test("explicit demo, filtered search, route selection, export and history", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Inicia sesión" })).toBeVisible();
  await page.getByRole("button", { name: "Explorar demo" }).click();
  await expect(page.getByText("Modo demostración · datos de ejemplo")).toBeVisible();
  await page.getByRole("button", { name: "Buscar en la demostración" }).click();
  await expect(page.getByText("4 detecciones · 2 rutas candidatas · Demostración")).toBeVisible();
  await page.getByRole("button", { name: "Ruta 2" }).click();
  await expect(page.getByText("Hay tramos distantes", { exact: false })).toBeVisible();
  await expect(page.locator(".map-wrapper")).toHaveAttribute("data-route-visible", "true", { timeout: 15_000 });
  await expect(page.getByText("Geometría vial OSRM", { exact: false })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar resultados JSON" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^vigia-demo-.*\.json$/);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("console.png"), fullPage: true });
  await page.getByRole("button", { name: "Trayectorias", exact: false }).first().click();
  await expect(page.getByRole("heading", { name: "Historial de consultas" })).toBeVisible();
  await expect(page.locator(".history-list > button")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("empty results, invalid time window and live radius output", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explorar demo" }).click();
  await page.getByRole("combobox", { name: "Color", exact: true }).selectOption("red");
  await page.getByRole("button", { name: "Buscar en la demostración" }).click();
  await expect(page.getByText("Sin trayectorias para estos filtros")).toBeVisible();
  await page.getByLabel("Hasta", { exact: true }).fill("08:00");
  await page.getByRole("button", { name: "Buscar en la demostración" }).click();
  await expect(page.locator(".query-card [role=alert]")).toContainText("La hora final debe ser posterior");
  const slider = page.getByRole("slider");
  await slider.fill("100");
  await expect(page.locator(".radius-label output")).toHaveText("100 m");
});

test("central queries send actual filters and failures stay visible", async ({ page }) => {
  await page.unroute("**/api/monitoring/devices");
  await page.route("**/api/monitoring/devices", (route) => route.fulfill({ json: DEMO_DEVICES }));
  await signedIn(page);
  await page.goto("/");
  await expect(page.getByText("Servicio central conectado", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cargar escenario de prueba" }).click();
  await page.route("**/api/monitoring/queries", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual(DEMO_QUERY);
    await route.fulfill({ json: runDemoQuery(DEMO_QUERY) });
  });
  await page.getByRole("button", { name: "Buscar coincidencias", exact: true }).click();
  await expect(page.getByText("4 detecciones · 2 rutas candidatas · Servicio central")).toBeVisible();
  await page.unroute("**/api/monitoring/queries");
  await page.route("**/api/monitoring/queries", (route) => route.fulfill({ status: 503, json: { error: "Servicio central no disponible" } }));
  await page.getByRole("button", { name: "Buscar coincidencias", exact: true }).click();
  await expect(page.locator(".query-card [role=alert]")).toHaveText("Servicio central no disponible");
  await expect(page.locator(".route-options")).toHaveCount(0);
  await expect(page.getByText("Modo demostración · datos de ejemplo")).toHaveCount(0);
});

test("camera filtering works without a vision stream", async ({ page }) => {
  await page.route("**/api/vision/status", (route) => route.fulfill({ json: { status: "offline", processingFps: 0, activeDetections: 0 } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Explorar demo" }).click();
  await page.getByRole("button", { name: "Cámaras", exact: false }).first().click();
  await page.getByRole("textbox", { name: "Filtrar cámaras" }).fill("Calle 84");
  await expect(page.locator(".device-list > button")).toHaveCount(1);
  await page.locator(".device-list > button").click();
  await expect(page.locator(".camera-selection")).toContainText("Calle 84");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("weighted route explains evidence and uses the evaluated geometry", async ({ page }, testInfo) => {
  await page.unroute("**/api/monitoring/devices");
  await page.route("**/api/monitoring/devices", (route) => route.fulfill({ json: DEMO_DEVICES }));
  const result = runDemoQuery(DEMO_QUERY);
  const first = result.routes[0];
  first.road_geometry = { source: "road-network", distance_m: 900, points: [
    { lng: -74.8172, lat: 11.0131 }, { lng: -74.816, lat: 11.012 }, { lng: -74.8148, lat: 11.011 },
  ] };
  first.explanation = {
    model: "weighted-evidence-v2", calibrated_probability: false,
    weights: { detection: .35, time: .4, appearance: .15, road: .1 },
    geometric_mean: .8, coverage_bonus: 0, search_pruned: false,
    segments: [{ from_camera: "CAM-01", to_camera: "CAM-02", option_index: 1,
      distance_m: 900, observed_seconds: 81, expected_seconds: 81, source: "osrm", score: .8,
      gap_penalty: .85, source_penalty: 1 }],
  };
  let geometryCalls = 0;
  await page.unroute("**/api/monitoring/route-geometry");
  await page.route("**/api/monitoring/route-geometry", (route) => { geometryCalls++; return route.abort(); });
  await page.route("**/api/monitoring/queries", (route) => route.fulfill({ json: result }));
  await signedIn(page);
  await page.goto("/");
  await expect(page.getByText("Servicio central conectado", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cargar escenario de prueba" }).click();
  await page.getByRole("button", { name: "Buscar coincidencias", exact: true }).click();
  await page.getByText("¿Por qué aparece esta ruta?", { exact: true }).click();
  await expect(page.getByText("Es un puntaje de compatibilidad", { exact: false })).toBeVisible();
  await expect(page.getByText("CAM-01 → CAM-02 · alternativa 2")).toBeVisible();
  await expect(page.getByText("Geometría vial OSRM · alternativa evaluada · 0.90 km")).toBeVisible();
  await expect(page.getByText("Compatibilidad temporal", { exact: true })).toBeVisible();
  expect(geometryCalls).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("weighted-evidence.png"), fullPage: true });
});

test("sign-in opens the central console, export goes through the server and logout ends the session", async ({ page }) => {
  await page.unroute("**/api/monitoring/devices");
  await page.route("**/api/monitoring/devices", (route) => route.fulfill({ json: DEMO_DEVICES }));
  await page.route("**/api/auth/login", async (route) => {
    const body = route.request().postDataJSON();
    if (body.password !== "contraseña-larga-ok") return route.fulfill({ status: 401, json: { error: "Correo o contraseña incorrectos." } });
    await signedIn(page);
    await route.fulfill({ json: { user: OPERATOR, expires_at: "2026-10-09T08:00:00Z" } });
  });
  const result = runDemoQuery(DEMO_QUERY);
  await page.route("**/api/monitoring/queries", (route) => route.fulfill({ json: result }));
  let exported = 0;
  await page.route(`**/api/monitoring/queries/${result.query.id}/export`, (route) => { exported++; return route.fulfill({ json: { notice: "Trayectorias estimadas", exported_by: OPERATOR.email, routes: [] } }); });
  let loggedOut = false;
  await page.route("**/api/auth/logout", async (route) => {
    loggedOut = true;
    await page.unroute("**/api/auth/session");
    await page.route("**/api/auth/session", (r) => r.fulfill({ status: 401, json: { error: "Sin sesión." } }));
    await route.fulfill({ status: 204 });
  });

  await page.goto("/");
  await page.getByLabel("Correo").fill(OPERATOR.email);
  await page.getByLabel("Contraseña").fill("incorrecta");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.locator(".login-card [role=alert]")).toHaveText("Correo o contraseña incorrectos.");
  await page.getByLabel("Contraseña").fill("contraseña-larga-ok");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("Servicio central conectado", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cargar escenario de prueba" }).click();
  await page.getByRole("button", { name: "Buscar coincidencias", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar resultados JSON" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(`vigia-${result.query.id}.json`);
  expect(exported).toBe(1);
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page.getByRole("heading", { name: "Inicia sesión" })).toBeVisible();
  expect(loggedOut).toBe(true);
});

test("an expired session during a search returns to sign-in", async ({ page }) => {
  await page.unroute("**/api/monitoring/devices");
  await page.route("**/api/monitoring/devices", (route) => route.fulfill({ json: DEMO_DEVICES }));
  await signedIn(page);
  await page.goto("/");
  await expect(page.getByText("Servicio central conectado", { exact: true })).toBeVisible();
  await page.unroute("**/api/auth/session");
  await page.route("**/api/auth/session", (route) => route.fulfill({ status: 401, json: { error: "Sin sesión." } }));
  await page.route("**/api/monitoring/queries", (route) => route.fulfill({ status: 401, json: { error: "Tu sesión terminó." } }));
  await page.getByRole("button", { name: "Buscar coincidencias", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Inicia sesión" })).toBeVisible();
});
