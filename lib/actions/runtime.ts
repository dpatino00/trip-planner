import { createActionHandlers } from "@/lib/actions/handlers";
import { createRateLimiter } from "@/lib/trips/rate-limit";
import { createTripRepository } from "@/lib/trips/repository";
import {
  getDevelopmentTripRepository,
  type TripRepository,
} from "@/lib/trips/repository-memory";

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

let configured: ReturnType<typeof createActionHandlers> | null = null;

export function getActionHandlers() {
  if (configured) return configured;
  const repository =
    process.env.NODE_ENV === "production"
      ? lazyProductionRepository()
      : getDevelopmentTripRepository();
  const actionKey =
    process.env.TRIP_GPT_ACTION_KEY ??
    (process.env.NODE_ENV === "production"
      ? ""
      : "local-trip-gpt-action-key-32-bytes-minimum");
  configured = createActionHandlers({
    repository,
    rateLimiter: createRateLimiter(),
    actionKey,
  });
  return configured;
}

export function actionConfigError() {
  return Response.json(
    {
      error: {
        code: "action-unavailable",
        message: "Custom GPT Actions are not configured",
        retryable: false,
      },
    },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}
