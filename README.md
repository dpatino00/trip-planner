# trip-planner

A mobile-first collaborative trip planner with saved ideas, live conditions,
reviewable itinerary proposals, and an embedded Ask experience.

Made with ❤️ by dpatino00 (@dpatino00).

## Get started for development

To get started:

```bash
git clone git@github.com:dpatino00/trip-planner
cd trip-planner
pixi install
```

Copy `.env.example` to `.env.local` for local web configuration. Embedded Ask
requires server-only `OPENAI_API_KEY` and `OPENAI_MODEL` values; use a model that
supports Responses API Structured Outputs and web search, such as
`gpt-5.4-mini`. Production trip
storage and rate limits require `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN`.

The private Custom GPT Action client is optional. Enable it with a 32-byte-or-
longer `TRIP_GPT_ACTION_KEY` and the server-bound `TRIP_GPT_TRIP_TOKEN`.
