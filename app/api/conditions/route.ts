import { createConditionsHandler } from "@/lib/conditions/handler";
import { openMeteoSource } from "@/lib/conditions/open-meteo";
import { createRateLimiter } from "@/lib/trips/rate-limit";

export const runtime = "nodejs";
const handler = createConditionsHandler({
  source: openMeteoSource,
  rateLimiter: createRateLimiter(),
});
export const GET = handler;
