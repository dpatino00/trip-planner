import { createCatalogHandlers } from "@/lib/catalog/handlers";
import { getCatalogService } from "@/lib/catalog/runtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return await createCatalogHandlers(getCatalogService()).importTrip(request);
  } catch {
    return Response.json(
      {
        error: {
          code: "catalog-unavailable",
          message: "Trip catalog is unavailable",
        },
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
