import { createTripChatHandler } from "@/lib/chat/handlers";
import { createConfiguredOpenAITripChatModel } from "@/lib/chat/openai";
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
const apiKey = process.env.OPENAI_API_KEY ?? "";
const modelName = process.env.OPENAI_MODEL ?? "";
const model =
  apiKey && modelName
    ? createConfiguredOpenAITripChatModel({ apiKey, model: modelName })
    : null;

export const POST = createTripChatHandler({
  repository,
  rateLimiter: createRateLimiter(),
  model,
  modelName,
});
