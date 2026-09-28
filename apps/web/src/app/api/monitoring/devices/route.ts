import { backendResponse } from "@/lib/backend-api";

export async function GET() {
  return backendResponse("/devices");
}
