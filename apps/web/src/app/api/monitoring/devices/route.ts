import { backendResponse } from "@/lib/backend-api";
import { sessionToken } from "@/lib/session";

export async function GET() {
  return backendResponse("/devices", undefined, await sessionToken());
}
