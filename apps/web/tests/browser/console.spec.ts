import { expect, test } from "@playwright/test";
import { DEMO_DEVICES, DEMO_QUERY, runDemoQuery } from "../../src/lib/demo-monitoring";

test.beforeEach(async ({ page }) => {
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
  await expect(page.getByText("Servicio central desconectado", { exact: true })).toBeVisible();
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
