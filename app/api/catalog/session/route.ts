import { createCatalogHandlers } from "@/lib/catalog/handlers";
import { getCatalogService } from "@/lib/catalog/runtime";

export const runtime = "nodejs";

function handlers() {
  return createCatalogHandlers(getCatalogService());
}

export async function POST(request: Request) {
  try {
    return await handlers().signIn(request);
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

export function DELETE() {
  try {
    return handlers().signOut();
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
