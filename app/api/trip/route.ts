import { createTripHandlers } from "@/lib/trips/handlers";
import { createRateLimiter } from "@/lib/trips/rate-limit";
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
const handlers = createTripHandlers({
  repository,
  rateLimiter: createRateLimiter(),
});

export const POST = handlers.POST;
export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
