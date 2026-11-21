import { expect, test } from "@playwright/test";
import { DEMO_DEVICES, DEMO_QUERY, runDemoQuery } from "../../src/lib/demo-monitoring";

const OPERATOR = { id: "00000000-0000-4000-8000-000000000001", email: "ana@vigia.test", display_name: "Ana Operadora", role: "operator" };

/** The query form starts folded behind the «Nueva consulta» search pill. */
async function openQuery(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Nueva consulta" }).click();
}

const LANDING = "De observaciones aisladas a recorridos posibles.";

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
  await expect(page.getByRole("heading", { name: LANDING })).toBeVisible();
  await page.getByRole("button", { name: "Explorar demo" }).first().click();
  await expect(page.getByText("Modo demostración · datos de ejemplo")).toBeVisible();
  await openQuery(page);
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
  await page.getByRole("button", { name: "Consultas", exact: false }).first().click();
  await expect(page.getByRole("heading", { name: "Historial de consultas" })).toBeVisible();
  await expect(page.locator(".history-list > button")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("the demo explains each screen and its back arrow returns to the landing", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explorar demo" }).first().click();
  await expect(page.getByRole("heading", { name: "Así ve un operador su red de cámaras" })).toBeVisible();
  await page.getByRole("button", { name: "Abrir una consulta" }).click();
  await expect(page.getByRole("heading", { name: "Describe el vehículo que buscas" })).toBeVisible();
  await page.getByRole("button", { name: "Buscar con este caso" }).click();
  await expect(page.getByText("4 detecciones · 2 rutas candidatas · Demostración")).toBeVisible();
  await expect(page.getByRole("heading", { name: "VIGÍA conecta las detecciones en recorridos" })).toBeVisible();
  await page.getByRole("button", { name: "Ver las cámaras" }).click();
  await expect(page.getByRole("heading", { name: "Dispositivos de la red." })).toBeVisible();
  await page.getByRole("button", { name: "Tu red" }).click();
  await page.getByRole("button", { name: "Volver al inicio" }).click();
  await expect(page.getByRole("heading", { name: LANDING })).toBeVisible();
});

test("signed in, Resumen has no back arrow", async ({ page }) => {
  await signedIn(page);
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Red Barranquilla", exact: false })).toBeVisible();
  await expect(page.locator(".back-button")).toHaveCount(0);
  await expect(page.locator(".demo-guide")).toHaveCount(0);
  await page.getByRole("button", { name: "Cámaras", exact: false }).first().click();
  await expect(page.getByRole("button", { name: "Volver", exact: true })).toBeVisible();
});

test("date and times can be typed or picked from the chevron", async ({ page }) => {
  await page.goto("/?demo=1");
  await openQuery(page);
  const day = page.getByRole("combobox", { name: "Día", exact: true });
  await day.fill("7");
  await day.press("Tab");
  await expect(day).toHaveValue("07");
  const to = page.getByRole("combobox", { name: "Hasta", exact: true });
  await to.fill("1 pm");
  await to.press("Tab");
  await expect(to).toHaveValue("01:00 p. m.");
  await page.getByRole("button", { name: "Mostrar opciones de Desde" }).click();
  await page.getByRole("option", { name: "09:45 a. m." }).click();
  await expect(page.getByRole("combobox", { name: "Desde", exact: true })).toHaveValue("09:45 a. m.");
  await page.getByRole("button", { name: "Mostrar opciones de Mes" }).click();
  await page.getByRole("option", { name: "09", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Mes", exact: true })).toHaveValue("09");
  // The cameras, the vehicle and the colour work the same way: typing filters by name.
  const point = page.getByRole("combobox", { name: "Punto de búsqueda" });
  await point.fill("venezuela");
  await expect(page.getByRole("option")).toHaveCount(1);
  await point.press("Enter");
  await expect(point).toHaveValue("Parque Venezuela - CAM-03");
  await page.getByRole("button", { name: "Mostrar opciones de Vehículo" }).click();
  await page.getByRole("option", { name: "Motocicleta" }).click();
  await expect(page.getByRole("combobox", { name: "Vehículo", exact: true })).toHaveValue("Motocicleta");
});

test("empty results, invalid time window and live radius output", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explorar demo" }).first().click();
  await openQuery(page);
  await page.getByRole("button", { name: "Mostrar opciones de Color" }).click();
  await page.getByRole("option", { name: "Rojo", exact: true }).click();
  await page.getByRole("button", { name: "Buscar en la demostración" }).click();
  await expect(page.getByText("Sin trayectorias para estos filtros")).toBeVisible();
  await page.getByRole("button", { name: "Ajustar consulta" }).click();
  await page.getByLabel("Hasta", { exact: true }).fill("08:00");
  await page.getByRole("button", { name: "Buscar en la demostración" }).click();
  await expect(page.locator(".query-card [role=alert]")).toContainText("La hora final debe ser posterior");
  const slider = page.getByRole("slider");
  await slider.fill("100");
  await expect(page.locator(".radius-label output")).toHaveText("100m");
});

test("central queries send actual filters and failures stay visible", async ({ page }) => {
  await page.unroute("**/api/monitoring/devices");
  await page.route("**/api/monitoring/devices", (route) => route.fulfill({ json: DEMO_DEVICES }));
  await signedIn(page);
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Red Barranquilla · Servicio central conectado" })).toBeVisible();
  await openQuery(page);
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
  await page.getByRole("button", { name: "Volver" }).click();
  await page.getByRole("button", { name: "Buscar coincidencias", exact: true }).click();
  await expect(page.locator(".query-card [role=alert]")).toHaveText("Servicio central no disponible");
  await expect(page.locator(".route-options")).toHaveCount(0);
  await expect(page.getByText("Modo demostración · datos de ejemplo")).toHaveCount(0);
});

test("camera filtering and selection, without any video in the console", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explorar demo" }).first().click();
  await page.getByRole("button", { name: "Cámaras", exact: false }).first().click();
  await page.getByRole("textbox", { name: "Filtrar cámaras" }).fill("Calle 84");
  await expect(page.locator(".device-list > button")).toHaveCount(1);
  await page.locator(".device-list > button").click();
  await expect(page.locator(".camera-selection")).toContainText("Calle 84");
  await expect(page.locator("img[alt*='Transmisión'], .preview-frame")).toHaveCount(0);
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
  await expect(page.getByRole("status", { name: "Red Barranquilla · Servicio central conectado" })).toBeVisible();
  await openQuery(page);
  await page.getByRole("button", { name: "Cargar escenario de prueba" }).click();
  await page.getByRole("button", { name: "Buscar coincidencias", exact: true }).click();
  // «¿Por qué aparece esta ruta?» comes before the cameras and their confidence.
  await expect(page.locator(".route-rule + .route-evidence")).toBeVisible();
  expect(await page.locator(".routes-card").evaluate((card) => !!(card.querySelector(".route-evidence")!.compareDocumentPosition(card.querySelector(".timeline")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
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
  await page.getByRole("button", { name: "Inicia sesión" }).click();
  await expect(page.getByRole("heading", { name: "Inicia sesión" })).toBeVisible();
  await page.getByLabel("Correo").fill(OPERATOR.email);
  await page.getByLabel("Contraseña").fill("incorrecta");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.locator(".login-card [role=alert]")).toHaveText("Correo o contraseña incorrectos.");
  await page.getByLabel("Contraseña").fill("contraseña-larga-ok");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("status", { name: "Red Barranquilla · Servicio central conectado" })).toBeVisible();
  await openQuery(page);
  await page.getByRole("button", { name: "Cargar escenario de prueba" }).click();
  await page.getByRole("button", { name: "Buscar coincidencias", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar resultados JSON" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(`vigia-${result.query.id}.json`);
  expect(exported).toBe(1);
  await page.getByRole("button", { name: "Cuenta" }).click();
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page.getByRole("heading", { name: LANDING })).toBeVisible();
  expect(loggedOut).toBe(true);
});

test("an expired session during a search returns to sign-in", async ({ page }) => {
  await page.unroute("**/api/monitoring/devices");
  await page.route("**/api/monitoring/devices", (route) => route.fulfill({ json: DEMO_DEVICES }));
  await signedIn(page);
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Red Barranquilla · Servicio central conectado" })).toBeVisible();
  await page.unroute("**/api/auth/session");
  await page.route("**/api/auth/session", (route) => route.fulfill({ status: 401, json: { error: "Sin sesión." } }));
  await page.route("**/api/monitoring/queries", (route) => route.fulfill({ status: 401, json: { error: "Tu sesión terminó." } }));
  await openQuery(page);
  await page.getByRole("button", { name: "Buscar coincidencias", exact: true }).click();
  await expect(page.getByRole("heading", { name: LANDING })).toBeVisible();
});

test("admin reviews the audit trail and issues then revokes a node credential", async ({ page }) => {
  await page.unroute("**/api/auth/session");
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { user: { ...OPERATOR, role: "admin", display_name: "Admin" }, expires_at: "2026-10-09T08:00:00Z" } }));
  await page.unroute("**/api/monitoring/devices");
  await page.route("**/api/monitoring/devices", (route) => route.fulfill({ json: DEMO_DEVICES }));
  const audit = [
    { action: "query.exported", outcome: "allowed", occurred_at: "2026-10-08T15:00:00Z", user_id: "u1", user_email: "ana@vigia.test", camera_id: null, credential_id: null, detail: { query: "53918754-07d0", routes: 3 } },
    { action: "authz.denied", outcome: "forbidden", occurred_at: "2026-10-08T14:59:00Z", user_id: "u1", user_email: "ana@vigia.test", camera_id: null, credential_id: null, detail: { required: ["admin"] } },
  ];
  const categories: string[] = [];
  await page.route("**/api/admin/audit**", (route) => {
    const category = new URL(route.request().url()).searchParams.get("category") ?? "";
    categories.push(category);
    return route.fulfill({ json: category === "denied" ? [audit[1]] : audit });
  });
  let credentials = [{ id: "11111111-1111-4111-8111-111111111111", camera_id: "CAM-01", created_at: "2026-10-01T00:00:00Z", expires_at: "2099-01-01T00:00:00Z", revoked: false }];
  await page.route("**/api/admin/credentials", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({ camera_id: "CAM-02", days: 30 });
      const created = { id: "22222222-2222-4222-8222-222222222222", camera_id: "CAM-02", created_at: "2026-10-08T00:00:00Z", expires_at: "2099-01-01T00:00:00Z", revoked: false };
      credentials = [...credentials, created];
      return route.fulfill({ status: 201, json: { ...created, secret: "vigia_secreto_de_prueba" } });
    }
    return route.fulfill({ json: credentials });
  });
  let revoked = "";
  await page.route("**/api/admin/credentials/*", (route) => {
    revoked = route.request().url().split("/").at(-1) ?? "";
    credentials = credentials.map((item) => item.id === revoked ? { ...item, revoked: true } : item);
    return route.fulfill({ status: 204 });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Administración", exact: false }).first().click();
  await expect(page.getByRole("heading", { name: "Auditoría de uso" })).toBeVisible();
  await expect(page.getByText("Exportación de consulta")).toBeVisible();
  await expect(page.getByText("Sin permiso", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Denegados" }).click();
  await expect(page.getByText("Exportación de consulta")).toHaveCount(0);
  expect(categories).toContain("denied");

  await page.getByRole("combobox", { name: "Cámara", exact: true }).selectOption("CAM-02");
  await page.getByRole("combobox", { name: "Vigencia" }).selectOption("30");
  await page.getByRole("button", { name: "Emitir credencial" }).click();
  await expect(page.getByText("vigia_secreto_de_prueba")).toBeVisible();
  await page.getByRole("button", { name: "Ya lo guardé" }).click();
  await expect(page.getByText("vigia_secreto_de_prueba")).toHaveCount(0);

  await page.getByRole("button", { name: "Revocar credencial de CAM-01" }).click();
  await page.getByRole("button", { name: "Revocar", exact: true }).click();
  await expect(page.getByText("Revocada", { exact: true })).toBeVisible();
  expect(revoked).toBe("11111111-1111-4111-8111-111111111111");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("admin deletes an edge node only after confirming", async ({ page }) => {
  await page.unroute("**/api/auth/session");
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { user: { ...OPERATOR, role: "admin", display_name: "Admin" }, expires_at: "2026-10-09T08:00:00Z" } }));
  await page.unroute("**/api/monitoring/devices");
  await page.route("**/api/monitoring/devices", (route) => route.fulfill({ json: DEMO_DEVICES }));
  await page.route("**/api/admin/audit**", (route) => route.fulfill({ json: [] }));
  let credentialLoads = 0;
  await page.route("**/api/admin/credentials", (route) => { credentialLoads++; return route.fulfill({ json: [] }); });
  const deleted: string[] = [];
  await page.route("**/api/admin/devices/*", (route) => {
    expect(route.request().method()).toBe("DELETE");
    deleted.push(route.request().url().split("/").at(-1) ?? "");
    return route.fulfill({ status: 204 });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Administración", exact: false }).first().click();
  const nodes = page.getByRole("article", { name: "Nodos edge" });
  await expect(nodes.getByText("CAM-02", { exact: true })).toBeVisible();

  await nodes.getByRole("button", { name: "Eliminar nodo CAM-02" }).click();
  await expect(nodes.getByText("¿Estás seguro de eliminar este nodo?")).toBeVisible();
  await nodes.getByRole("button", { name: "Cancelar" }).click();
  await expect(nodes.getByText("¿Estás seguro de eliminar este nodo?")).toHaveCount(0);
  expect(deleted).toEqual([]);

  const loadsBefore = credentialLoads;
  await nodes.getByRole("button", { name: "Eliminar nodo CAM-02" }).click();
  await nodes.getByRole("button", { name: "Eliminar", exact: true }).click();
  await expect(nodes.getByText("CAM-02", { exact: true })).toHaveCount(0);
  await expect(nodes.getByText("Nodo CAM-02 eliminado", { exact: false })).toBeVisible();
  expect(deleted).toEqual(["demo-02"]);
  // Its tokens were revoked: the credentials list reloads, and the camera picker drops it.
  await expect.poll(() => credentialLoads).toBeGreaterThan(loadsBefore);
  await expect(page.getByRole("combobox", { name: "Cámara", exact: true }).locator("option", { hasText: "CAM-02" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("operators do not see the administration entry", async ({ page }) => {
  await page.unroute("**/api/monitoring/devices");
  await page.route("**/api/monitoring/devices", (route) => route.fulfill({ json: DEMO_DEVICES }));
  await signedIn(page);
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Red Barranquilla · Servicio central conectado" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Administración", exact: false })).toHaveCount(0);
});

test("on the scoring database a dataset case fills the whole query form", async ({ page }) => {
  const devices = [
    { id: "sc-1", external_id: "SC-01", name: "Carrera 58 · norte (dataset)", kind: "simulated", status: "simulated", lat: 11.01277, lng: -74.817474, camera_model: null },
    { id: "sc-7", external_id: "SC-07", name: "Calle 81 (dataset)", kind: "simulated", status: "simulated", lat: 11.008375, lng: -74.809824, camera_model: null },
  ];
  await page.unroute("**/api/monitoring/devices");
  await page.route("**/api/monitoring/devices", (route) => route.fulfill({ json: devices }));
  await page.route("**/api/monitoring/scenarios", (route) => route.fulfill({ json: [
    { id: "S01", title: "Recorrido limpio", challenge: "control", camera_id: "SC-07", radius_m: 2500, date: "2026-09-15", time_from: "07:00", time_to: "07:20", vehicle_type: "car", color: "white" },
    { id: "S02", title: "Dos vehículos iguales que se cruzan", challenge: "confusor", camera_id: "SC-07", radius_m: 2500, date: "2026-09-15", time_from: "07:20", time_to: "07:40", vehicle_type: "car", color: "silver" },
    { id: "S03", title: "Color no detectado", challenge: "apariencia incompleta", camera_id: "SC-07", radius_m: 2500, date: "2026-09-15", time_from: "07:40", time_to: "08:00", vehicle_type: "motorcycle", color: null },
  ] }));
  let sent: Record<string, unknown> | null = null;
  await page.route("**/api/monitoring/queries", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ json: runDemoQuery(DEMO_QUERY) });
  });
  await signedIn(page);
  await page.goto("/");
  await openQuery(page);
  await expect(page.getByRole("button", { name: "Cargar escenario de prueba" })).toHaveCount(0);
  const color = page.getByRole("combobox", { name: "Color", exact: true });
  await page.getByRole("combobox", { name: "Caso del dataset de pruebas" }).selectOption("S02");
  await expect(color).toHaveValue("Plateado");
  await page.getByRole("combobox", { name: "Caso del dataset de pruebas" }).selectOption("S03");
  await expect(color).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Punto de búsqueda" })).toHaveValue("Calle 81 (dataset) - SC-07");
  await expect(page.locator(".radius-label output")).toHaveText("2,5km");
  await page.getByRole("button", { name: "Buscar coincidencias", exact: true }).click();
  await expect.poll(() => sent).toEqual({ lat: 11.008375, lng: -74.809824, radius_m: 2500,
    time_from: "2026-09-15T07:40:00-05:00", time_to: "2026-09-15T08:00:00-05:00", vehicle_type: "motorcycle" });
});

test("the public site links the about page back to sign-in and the demo", async ({ page }) => {
  await page.goto("/nosotros");
  await expect(page.getByText("Regístrate")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Innovación que nace de un desafío real." })).toBeVisible();
  await page.getByRole("link", { name: "Explorar demo" }).click();
  await expect(page.getByText("Modo demostración · datos de ejemplo")).toBeVisible();
  await page.goto("/nosotros");
  await page.getByRole("link", { name: "Inicia sesión" }).click();
  await expect(page.getByRole("heading", { name: "Inicia sesión" })).toBeVisible();
  await page.getByRole("button", { name: "Volver al inicio" }).click();
  await page.getByRole("tab", { name: "Conexión", exact: false }).click();
  await expect(page.getByText("Los eventos se envían de forma segura a la plataforma central.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("an admin searches by plate, sees the recortes and confirms steps that recalculate the routes", async ({ page }) => {
  await page.unroute("**/api/auth/session");
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { user: { ...OPERATOR, role: "admin", display_name: "Admin" }, expires_at: "2026-10-09T08:00:00Z" } }));
  await page.unroute("**/api/monitoring/devices");
  await page.route("**/api/monitoring/devices", (route) => route.fulfill({ json: DEMO_DEVICES }));
  const result = runDemoQuery(DEMO_QUERY);
  const first = result.routes[0];
  first.detections = first.detections.map((hop, index) => ({ ...hop, has_thumbnail: index === 0, license_plate: index === 0 ? "ABC123" : null, confirmation: null }));
  let sent: Record<string, unknown> | null = null;
  await page.route("**/api/monitoring/queries", async (route) => { sent = route.request().postDataJSON(); await route.fulfill({ json: result }); });
  await page.route("**/api/detections/*/thumbnail", (route) => route.fulfill({ status: 404, json: { error: "x" } }));
  let verdict: unknown = null;
  await page.route(`**/api/monitoring/queries/${result.query.id}/confirmations/*`, async (route) => {
    verdict = route.request().method() === "PUT" ? route.request().postDataJSON().verdict : "undo";
    const confirmed = structuredClone(result);
    confirmed.routes = [confirmed.routes[0]];
    confirmed.routes[0].detections[0].confirmation = "match";
    await route.fulfill({ json: confirmed });
  });
  await page.goto("/");
  await openQuery(page);
  await page.getByRole("button", { name: "Cargar escenario de prueba" }).click();
  await page.getByLabel("Placa", { exact: true }).fill("abc-123");
  await page.getByRole("button", { name: "Buscar coincidencias", exact: true }).click();
  await expect.poll(() => sent).toMatchObject({ plate: "ABC123" });
  // Steps start closed: the recorte and the question appear only after opening them.
  await expect(page.getByRole("button", { name: "Sí", exact: true })).toHaveCount(0);
  // Only each step's own header: the step also nests the «Etiquetar para entrenamiento» summary,
  // which goes away once the recorte answers 404.
  for (const step of await page.locator(".hop-details > summary").all()) await step.click();
  await expect(page.getByLabel("Placa ABC123")).toBeVisible();
  await expect(page.getByText("Recorte vencido")).toBeVisible();
  await expect(page.getByText("Sin recorte").first()).toBeVisible();
  await page.getByRole("button", { name: "Sí", exact: true }).first().click();
  await expect.poll(() => verdict).toBe("match");
  await expect(page.getByRole("button", { name: "Sí", exact: true }).first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".hop-verdict.match")).toHaveText("Confirmado");
  await expect(page.locator(".route-options button")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

// A real (tiny) JPEG, so the thumbnail loads instead of falling back to «Recorte vencido».
const TINY_JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAGAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3CiiigD//2Q==", "base64");

test("an admin opens a recorte enlarged and closes it with Escape or the button", async ({ page }) => {
  await page.unroute("**/api/auth/session");
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { user: { ...OPERATOR, role: "admin", display_name: "Admin" }, expires_at: "2026-10-09T08:00:00Z" } }));
  await page.unroute("**/api/monitoring/devices");
  await page.route("**/api/monitoring/devices", (route) => route.fulfill({ json: DEMO_DEVICES }));
  const result = runDemoQuery(DEMO_QUERY);
  result.routes[0].detections = result.routes[0].detections.map((hop, index) => ({ ...hop, has_thumbnail: index === 0, license_plate: index === 0 ? "ABC123" : null, confirmation: null }));
  await page.route("**/api/monitoring/queries", (route) => route.fulfill({ json: result }));
  let thumbnails = 0;
  await page.route("**/api/detections/*/thumbnail", (route) => { thumbnails++; return route.fulfill({ status: 200, contentType: "image/jpeg", body: TINY_JPEG }); });
  await page.route("**/api/detections/*/annotations", (route) => route.fulfill({ json: [] }));

  await page.goto("/");
  await openQuery(page);
  await page.getByRole("button", { name: "Cargar escenario de prueba" }).click();
  await page.getByRole("button", { name: "Buscar coincidencias", exact: true }).click();
  await page.locator(".hop-details > summary").first().click();
  const zoom = page.getByRole("button", { name: /^Ampliar recorte del vehículo en / });
  await expect(zoom).toBeVisible();
  await zoom.click();
  const dialog = page.getByRole("dialog", { name: /Recorte ampliado · .* · ABC123/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("img")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await zoom.click();
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(thumbnails).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("operators get no plate field and no confirmation controls", async ({ page }) => {
  await page.unroute("**/api/monitoring/devices");
  await page.route("**/api/monitoring/devices", (route) => route.fulfill({ json: DEMO_DEVICES }));
  await signedIn(page);
  await page.route("**/api/monitoring/queries", (route) => route.fulfill({ json: runDemoQuery(DEMO_QUERY) }));
  await page.goto("/");
  await openQuery(page);
  await expect(page.getByLabel("Placa", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Cargar escenario de prueba" }).click();
  await page.getByRole("button", { name: "Buscar coincidencias", exact: true }).click();
  await expect(page.getByText("4 detecciones · 2 rutas candidatas · Servicio central")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sí", exact: true })).toHaveCount(0);
});

test("a plate nobody read still lists routes, with a notice", async ({ page }) => {
  await page.unroute("**/api/auth/session");
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { user: { ...OPERATOR, role: "admin", display_name: "Admin" }, expires_at: "2026-10-09T08:00:00Z" } }));
  await page.unroute("**/api/monitoring/devices");
  await page.route("**/api/monitoring/devices", (route) => route.fulfill({ json: DEMO_DEVICES }));
  await page.route("**/api/monitoring/queries", (route) => route.fulfill({ json: { ...runDemoQuery(DEMO_QUERY), plate_unread: true } }));

  await page.goto("/");
  await openQuery(page);
  await page.getByRole("button", { name: "Cargar escenario de prueba" }).click();
  await page.getByLabel("Placa", { exact: true }).fill("KQV159");
  await page.getByRole("button", { name: "Buscar coincidencias", exact: true }).click();
  await expect(page.getByText("Ninguna cámara leyó la placa buscada en esta ventana.", { exact: false })).toBeVisible();
  await expect(page.locator(".route-options button").first()).toBeVisible();
});

test("the Android page guides the download and the footer carries the rights", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "La app de VIGÍA, en tu teléfono." })).toBeVisible();
  const download = page.getByRole("link", { name: /Descargar para Android/ });
  await expect(download).toHaveAttribute("href", /^\/descargas\/vigia.*\.apk$/);
  await expect(page.getByRole("navigation", { name: "Contenido de la guía" }).getByRole("link")).toHaveCount(7);
  await page.getByRole("navigation", { name: "Contenido de la guía" }).getByRole("link", { name: "Verificar el archivo" }).click();
  await expect(page.getByRole("heading", { name: "Verificar el archivo" })).toBeInViewport();
  await expect(page.getByText("© 2026 Equipo VIGÍA. Todos los derechos reservados.")).toBeVisible();
  await expect(page.getByText("Android es una marca de Google LLC", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
