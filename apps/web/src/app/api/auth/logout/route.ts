import { cookies } from "next/headers";
import { SESSION_COOKIE, backendFetch } from "@/lib/session";

export async function POST() {
  try {
    await backendFetch("/auth/logout", { method: "POST" });  // Revokes server-side, not just the cookie.
  } catch {
    // The cookie is removed anyway; the server session still expires on its own.
  }
  (await cookies()).delete(SESSION_COOKIE);
  return new Response(null, { status: 204 });
}
