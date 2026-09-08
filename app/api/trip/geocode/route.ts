import { geocodeDestination } from "@/lib/geocoding/open-meteo";
import { createRateLimiter } from "@/lib/trips/rate-limit";
import { createTripHandlers } from "@/lib/trips/handlers";
import { createTripRepository } from "@/lib/trips/repository";
import {
  getDevelopmentTripRepository,
  type TripRepository,
} from "@/lib/trips/repository-memory";

export const runtime = "nodejs";

function lazyProductionRepository(): TripRepository {
  let configured: TripRepository | null = null;
  const current = () => (configured ??= createTripRepository());
  return {
    create: (key, value) => current().create(key, value),
    get: (key) => current().get(key),
    update: (key, version, value) => current().update(key, version, value),
    delete: (key) => current().delete(key),
  };
}

const repository =
  process.env.NODE_ENV === "production"
    ? lazyProductionRepository()
    : getDevelopmentTripRepository();
const tripHandlers = createTripHandlers({
  repository,
  rateLimiter: createRateLimiter(),
});

export async function GET(request: Request) {
  const authorized = await tripHandlers.GET(request);
  if (!authorized.ok) return authorized;
  const query = new URL(request.url).searchParams.get("query")?.trim() ?? "";
  if (!query || query.length > 120) {
    return Response.json(
      { error: { code: "invalid-query", message: "Location is invalid" } },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    return Response.json(
      { results: await geocodeDestination(query) },
      {
        headers: { "cache-control": "no-store" },
      },
    );
  } catch {
    return Response.json(
      {
        error: {
          code: "geocoding-unavailable",
          message: "Location search is temporarily unavailable",
        },
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
