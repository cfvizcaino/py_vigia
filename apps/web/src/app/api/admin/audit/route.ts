import { backendJson } from "@/lib/session";

const CATEGORIES = new Set(["sessions", "queries", "preview", "changes", "credentials", "denied"]);

export async function GET(request: Request) {
  const input = new URL(request.url).searchParams;
  const search = new URLSearchParams({ limit: "50" });
  const category = input.get("category");
  const before = input.get("before");
  if (category) {
    if (!CATEGORIES.has(category)) return Response.json({ error: "Categoría no válida." }, { status: 400 });
    search.set("category", category);
  }
  if (before) {
    if (Number.isNaN(Date.parse(before))) return Response.json({ error: "Fecha no válida." }, { status: 400 });
    search.set("before", before);
  }
  return backendJson(`/admin/audit?${search}`);
}
