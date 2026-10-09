import { cookies } from "next/headers";
import { backendUrl } from "@/lib/backend-api";
import { SESSION_COOKIE, type Session } from "@/lib/session";

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  let input: { email?: unknown; password?: unknown };
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: "El cuerpo debe ser JSON válido." }, { status: 400, headers });
  }
  if (typeof input.email !== "string" || typeof input.password !== "string" || !input.email || !input.password) {
    return Response.json({ error: "Escribe tu correo y contraseña." }, { status: 400, headers });
  }
  try {
    const response = await fetch(backendUrl("/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: input.email, password: input.password }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 429) return Response.json({ error: "Demasiados intentos fallidos. Espera 15 minutos." }, { status: 429, headers });
    if (!response.ok) {
      return Response.json(
        { error: response.status < 500 ? "Correo o contraseña incorrectos." : "El servicio central encontró un error." },
        { status: response.status < 500 ? 401 : 502, headers },
      );
    }
    const body = await response.json() as Session & { token: string };
    (await cookies()).set(SESSION_COOKIE, body.token, {
      httpOnly: true,
      sameSite: "strict",
      // Compose serves plain HTTP on loopback; behind TLS the cookie must be Secure.
      secure: new URL(request.url).protocol === "https:" || process.env.SESSION_COOKIE_SECURE === "true",
      path: "/",
      expires: new Date(body.expires_at),
    });
    return Response.json({ user: body.user, expires_at: body.expires_at }, { headers });
  } catch {
    return Response.json({ error: "No se pudo conectar con el servicio central." }, { status: 503, headers });
  }
}
