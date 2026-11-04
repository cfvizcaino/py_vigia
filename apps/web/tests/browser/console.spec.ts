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

test("empty results, invalid time window and live radius output", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explorar demo" }).first().click();
  await openQuery(page);
  await page.getByRole("combobox", { name: "Color", exact: true }).selectOption("red");
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
  await expect(page.locator(".routes-card > *").last()).toHaveClass(/route-evidence/);
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
  await expect(color).toHaveValue("silver");
  await expect(color.locator("option:checked")).toHaveText("Plateado");
  await page.getByRole("combobox", { name: "Caso del dataset de pruebas" }).selectOption("S03");
  await expect(color).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Punto de búsqueda" })).toHaveValue("SC-07");
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
  for (const step of await page.locator(".hop-details summary").all()) await step.click();
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
