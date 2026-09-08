import { createCatalogHandlers } from "@/lib/catalog/handlers";
import { getCatalogService } from "@/lib/catalog/runtime";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ tripId: string }> },
) {
  try {
    const { tripId } = await context.params;
    return await createCatalogHandlers(getCatalogService()).remove(
      request,
      tripId,
    );
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
