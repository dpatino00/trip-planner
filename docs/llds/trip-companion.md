# Conversational Trip Companion — Low-Level Design

**Created**: 2026-09-01
**Last updated**: 2026-09-02
**Related HLD**: [Conversational Trip Companion — High-Level Design](../high-level-design.md)

## Context and Design Philosophy

The trip companion is a destination-neutral shared plan. The website owns the
durable trip state and visual experience. A private Custom GPT is an additional
client that translates conversation into authenticated, structured mutations.
It does not store the canonical plan, edit application code, or run a separate
autonomous workflow.

The implementation follows these principles:

- Saved places and itinerary data remain useful when external services fail.
- Custom places are first-class trip data rather than additions to a hardcoded
  destination catalog.
- Place imagery is optional and is not part of the required place contract.
- Every place receives a generated Maps search link; a supplied source URL is an
  optional convenience and is never represented as independently verified.
- GPT mutations pass through the same validation, versioning, idempotency, and
  persistence code as browser mutations.
- Optimization is deterministic, explainable, synchronous for the initial
  release, and produces proposals rather than silently rewriting confirmed plans.
- A private trip link remains a bearer credential and must not be logged or
  persisted by browser code.
- Optional device location never leaves the browser.
- Mobile usability and accessibility are behavior, not later polish.

## Runtime and Component Boundaries

The web application uses the Next.js App Router, React, TypeScript, Tailwind CSS,
and the repository's configured Node.js runtime. Server Components render static
framing. Client Components own authenticated trip state, interactions, sharing,
and offline status.

```text
Custom GPT
└── OpenAPI Action client
    ├── static Action API key in Authorization header
    └── current trip token in X-Trip-Token header

Next.js application
├── landing and trip creation
├── /trip workspace
│   ├── Today
│   ├── Ideas
│   └── Plan
├── /api/trip browser route
├── /api/actions/trip Action routes
└── /api/conditions destination-neutral condition route

server libraries
├── trip and place schemas
├── trip repository and atomic semantic mutations
├── Action authentication
├── deterministic recommendation and proposal optimizer
├── Open-Meteo adapters and normalization
└── rate limits and secret hashing

browser-only libraries
├── SWR request cache and revalidation
├── IndexedDB offline snapshots
├── service-worker registration
└── optional geolocation and distance scoring
```

The browser and Action handlers call one trip service. Production request state
must never live in mutable module scope. Weather, air-quality, and optional marine
requests start together and resolve with `Promise.allSettled` so one failure does
not block the remaining data.

The checked-in `docs/gpt-action-openapi.yaml` file will be the Custom GPT Action
contract. It will describe only the Action endpoints in this LLD and will be
contract-tested against the request schemas. The application will not generate a
second OpenAPI contract at runtime. The checked-in
`docs/custom-gpt-instructions.md` file will contain the matching text to paste
into the private GPT's Instructions field.

## Data Models

All external input is parsed with Zod at its boundary. Dates use `YYYY-MM-DD`,
local times use `HH:mm`, timestamps use UTC ISO 8601, distances use miles,
temperatures use Fahrenheit, wind uses miles per hour, and wave height uses feet.

### Destination and place

```ts
type Daypart = "morning" | "midday" | "afternoon" | "golden-hour" | "evening";
type CostLevel = 0 | 1 | 2 | 3;
type PlaceProfile = "indoor" | "outdoor" | "coastal" | "mixed";

type Interest =
  | "coast"
  | "outdoors"
  | "food"
  | "culture"
  | "history"
  | "wildlife"
  | "nightlife"
  | "shopping"
  | "relaxing";

interface Coordinates {
  latitude: number;
  longitude: number;
}

interface TripDestination {
  name: string;
  locality: string | null;
  countryCode: string | null;
  coordinates: Coordinates | null;
  timeZone: string | null;
}

interface Place {
  id: string;
  name: string;
  summary: string;
  locality: string | null;
  coordinates: Coordinates | null;
  interests: Interest[];
  tags: string[];
  profile: PlaceProfile;
  waterContact: boolean;
  preferredDayparts: Daypart[];
  durationMinutes: number | null;
  costLevel: CostLevel | null;
  accessibility: Array<"low-walking" | "step-free" | "accessible-parking">;
  reservationRecommended: boolean | null;
  sourceUrl: string | null;
  origin: "seed" | "chatgpt" | "manual";
  createdAt: string;
  updatedAt: string;
}
```

Names are 1–120 characters and summaries are at most 500 characters. Locality is
at most 120 characters. Coordinates must be finite and within geographic bounds.
Tags are lower-case strings of 1–30 characters, with at most ten unique tags.
Duration, when known, is 15–1,440 minutes.

Only `https:` source URLs are retained. A missing or rejected source URL does not
reject an otherwise valid place; the response carries a warning and the UI uses a
generated Google Maps or Apple Maps search URL based on `name + locality`. The
application does not fetch or scrape a supplied URL in the initial release.

The `origin` field describes how a place entered the trip, not whether its details
are authoritative. There is no required image field. Existing local artwork may
remain as generic decoration, but saved-place rendering cannot depend on it.

### Shared trip and itinerary

```ts
interface TripPreferences {
  interests: Interest[];
  maximumCost: CostLevel;
  pace: "relaxed" | "balanced" | "full";
  mobility: "standard" | "low-walking" | "step-free";
  notes: string;
}

interface ItineraryItem {
  id: string;
  placeId: string;
  date: string;
  startTime: string | null;
  durationMinutes: number | null;
  order: number;
  notes: string;
  status: "tentative" | "confirmed";
}

interface TripDocument {
  schemaVersion: 2;
  version: number;
  title: string;
  destination: TripDestination;
  startDate: string;
  endDate: string;
  homeBase: { label: string; coordinates: Coordinates | null } | null;
  preferences: TripPreferences;
  places: Place[];
  favoritePlaceIds: string[];
  itinerary: ItineraryItem[];
  proposals: PlanProposal[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}
```

Trip titles are 1–80 characters, trips span 1–31 inclusive calendar days, and
preference notes are at most 1,000 characters. Itinerary dates must fall within
the trip. Place references must exist in the same trip document. Server-owned
IDs, versions, timestamps, and origin values cannot be overridden by an Action
request.

New trips default to balanced pace, standard mobility, maximum cost level 2, and
the interests `outdoors`, `food`, `culture`, and `relaxing`. Destination name is
required; coordinates and time zone may be supplied during creation or later by
the GPT. Condition-based ranking remains unavailable until destination
coordinates exist.

Expiration is the later of 30 days after creation or 180 days after the trip end
date. Writes do not extend expiration. The Redis envelope includes the 50 most
recent mutation IDs for idempotency; those IDs are not returned to clients.

### Plan proposals

```ts
type ProposalChange =
  | {
      type: "add-item";
      placeId: string;
      date: string;
      startTime: string | null;
      rationale: string;
    }
  | {
      type: "move-tentative-item";
      itemId: string;
      date: string;
      startTime: string | null;
      rationale: string;
    }
  | {
      type: "reorder-tentative-items";
      date: string;
      orderedItemIds: string[];
      rationale: string;
    };

interface PlanProposal {
  id: string;
  baseVersion: number;
  status: "pending" | "applied" | "dismissed" | "superseded";
  summary: string;
  changes: ProposalChange[];
  createdAt: string;
}
```

At most three proposals are retained. Creating a new proposal marks older pending
proposals as superseded. A proposal contains at most ten changes. It may add
unscheduled places and rearrange tentative items, but it cannot remove an item or
move/reorder a confirmed item. Applying a proposal is one atomic semantic
mutation and requires its `baseVersion` to equal the current trip version. Places
added by an applied proposal enter the itinerary as tentative; the user may later
confirm them. Dismissing a proposal stores its dismissed status without changing
the itinerary.

### Version-one migration

The repository reader accepts existing schema-version-one San Diego documents.
It materializes referenced catalog places into `TripDocument.places`, converts
custom itinerary entries into embedded places, assigns the San Diego destination
and `America/Los_Angeles`, and marks existing itinerary items as `confirmed`.
Migration is deterministic and persists schema version two on the next successful
mutation. Unknown legacy place IDs render as unavailable placeholders and are not
silently discarded.

### Conditions and recommendations

```ts
type DataFreshness = "live" | "stale" | "unavailable";

interface ConditionsEnvelope {
  status: "live" | "degraded" | "unavailable";
  requestedFor: string;
  fetchedAt: string;
  expiresAt: string;
  coordinates: Coordinates | null;
  timeZone: string | null;
  temperatureF: number | null;
  apparentTemperatureF: number | null;
  precipitationProbability: number | null;
  windMph: number | null;
  weatherCode: number | null;
  uvIndex: number | null;
  airQualityIndex: { scale: "us-aqi"; value: number } | null;
  isDay: boolean | null;
  sunrise: string | null;
  sunset: string | null;
  marine: {
    status: DataFreshness;
    seaSurfaceTemperatureF: number | null;
    waveHeightFt: number | null;
    wavePeriodSeconds: number | null;
    disclaimer: string;
  } | null;
  source: "Open-Meteo";
}

interface Recommendation {
  placeId: string;
  score: number;
  reasons: string[];
  cautions: string[];
  distanceMiles: number | null;
  conditionsStatus: DataFreshness;
}
```

Conditions are requested for the trip destination coordinates. Open-Meteo
resolves the local time zone when the trip does not provide one. Marine data is
requested only when at least one saved place is coastal or water-contact. Missing
coordinates return an unavailable envelope without contacting the provider.

The existing 0–100 scoring components remain: preference fit 35, condition fit
30, time fit 20, and distance fit 15. Missing optional place or condition values
use the existing neutral scores rather than excluding the place. Equal scores
sort by normalized place name and then place ID for stable output.

The proposal optimizer uses the same recommendation scores. It considers only
trip dates, saved places, preferences, tentative itinerary items, and confirmed
items as fixed constraints. It fills open time with the highest-ranked
unscheduled places and orders tentative items using a nearest-next greedy pass
when coordinates exist. It never invents travel times, opening hours, or booking
availability. Every proposed change includes a short deterministic rationale.

## Browser API Contracts

All JSON routes reject unknown fields and return `Cache-Control: no-store` unless
the conditions route explicitly supplies public cache headers. Errors use:

```ts
interface ApiError {
  error: { code: string; message: string; retryable: boolean };
  warnings?: string[];
}
```

| Method and endpoint   | Input                                                          | Success                  | Errors                                                              |
| --------------------- | -------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------- |
| `POST /api/trip`      | Title, dates, destination, optional home base and preferences  | `201 { token, trip }`    | `400`, `429`, `503`                                                 |
| `GET /api/trip`       | `Authorization: Bearer <trip-token>`                           | `200 { trip }`           | `401`, `404`, `429`, `503`                                          |
| `PATCH /api/trip`     | Trip token plus one versioned semantic mutation                | `200 { trip }`           | `400`, `401`, `404`, `409`, `429`, `503`                            |
| `DELETE /api/trip`    | Trip token plus `{ confirmation: "DELETE" }`                   | `204`                    | `400`, `401`, `404`, `429`, `503`                                   |
| `GET /api/conditions` | Destination latitude, longitude, optional time and marine flag | `200 ConditionsEnvelope` | `400`, `429`; provider failure remains a `200` unavailable envelope |

Browser mutations include place add/update, preference changes, favorite changes,
itinerary changes, and proposal application or dismissal. They retain the
existing `{ baseVersion, mutationId, mutation }` envelope and atomic version
checks.

## Custom GPT Action Contracts

Official OpenAI documentation requires a GPT Action to describe its API through
an OpenAPI schema and supports API key or OAuth authentication. The initial
private integration uses API key authentication and does not call the OpenAI API
from the application.

Every Action request requires:

```http
Authorization: Bearer <TRIP_GPT_ACTION_KEY>
X-Trip-Token: <token extracted from the user's private trip link fragment>
```

The Action key proves the caller is the configured integration. The trip token
selects and authorizes one trip. Neither credential is accepted in a path, query
string, or JSON body. The GPT instructions tell it never to repeat the token in a
response and to request the private trip link when the current conversation does
not contain one.

| `operationId`        | Method and endpoint                                   | Input                                                                                              | Success behavior                                                                                               |
| -------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `getTripContext`     | `GET /api/actions/trip`                               | Required authentication headers                                                                    | Returns concise trip metadata, preferences, places, itinerary, latest pending proposal, and version            |
| `setTripDestination` | `POST /api/actions/trip/destination`                  | Version, mutation ID, destination name, and optional locality, country, coordinates, and time zone | Updates the destination context, refreshes applicable conditions on the next read, and returns the destination |
| `addPlace`           | `POST /api/actions/trip/places`                       | Version, mutation ID, required name, optional structured place fields                              | Adds one place idempotently, runs optimization, and returns the place plus latest proposal                     |
| `updatePlace`        | `PATCH /api/actions/trip/places/{placeId}`            | Version, mutation ID, allowlisted place changes                                                    | Updates one existing place, runs optimization, and returns the place plus latest proposal                      |
| `setTripPreferences` | `POST /api/actions/trip/preferences`                  | Version, mutation ID, complete preferences                                                         | Replaces preferences, runs optimization, and returns preferences plus latest proposal                          |
| `optimizeTrip`       | `POST /api/actions/trip/optimize`                     | Version and mutation ID                                                                            | Recomputes and stores a proposal without changing itinerary items                                              |
| `applyPlanProposal`  | `POST /api/actions/trip/proposals/{proposalId}/apply` | Version and mutation ID                                                                            | Atomically applies a still-current proposal after explicit conversational approval                             |

Action success bodies are concise and conversationally useful:

```ts
interface ActionResponse<T> {
  message: string;
  tripVersion: number;
  data: T;
  proposal: PlanProposal | null;
  warnings: string[];
}
```

The Action API never returns a trip token, Action key, internal storage key, or
raw provider response. It does not expose trip deletion, arbitrary generic
mutations, URL fetching, or application configuration.

`operationId`, field descriptions, and enums in the OpenAPI schema are explicit
because ChatGPT uses them to decide which Action to call and how to populate its
parameters. The `applyPlanProposal` description states that it may be called only
after the user explicitly accepts the identified proposal.

## Storage, Concurrency, and Rate Limits

Trip keys remain `trip:v1:<sha256(trip-token)>`; changing the document schema does
not rotate existing links. Redis stores one JSON envelope with its absolute
expiry. Raw credentials, device location, referrer, and client IP are not stored
in the trip document.

Browser and Action mutations share this sequence:

1. Authenticate both credentials required by the route and apply rate limits.
2. Read, migrate if necessary, and parse the current envelope.
3. Return the current document if the mutation ID was already applied.
4. Check `baseVersion`, validate the semantic mutation, and apply it in pure
   TypeScript.
5. For relevant changes, calculate and attach the new proposal before writing.
6. Use one Redis Lua script to check the stored version, write the new envelope,
   and preserve absolute expiry atomically.
7. Return `409` with current version information if another writer won.

The browser may retry one conflict after rebasing its semantic mutation. The GPT
must call `getTripContext` and repeat its requested mutation with a new mutation
ID after a conflict; the server never guesses at conversational intent.

Existing browser rate limits remain. Action reads are limited to 60 and Action
mutations to 30 per hashed Action-key/trip-token pair per minute. Rate-limit keys
expire with their windows. The application never stores raw client IPs or raw
credentials in rate-limit keys.

## Primary Behaviors

### Connect a conversation to a trip

The website exposes a “Copy link for ChatGPT” control that copies the existing
private trip link and explains that anyone with that link can edit the trip. The
user pastes it into their private GPT conversation. The GPT extracts the fragment
for the `X-Trip-Token` header and calls `getTripContext` before the first mutation.
No separate account connection is introduced.

### Add or update a place from conversation

When the user asks to add a place, the GPT calls `addPlace` with structured facts
it has from the conversation. Only the name is required. Invalid optional URLs or
coordinates are discarded with warnings so they do not block the save.

Before insertion, the server compares normalized name and locality against saved
places. An exact match returns the existing place as a successful idempotent no-op
with a duplicate warning. The server does not perform probabilistic duplicate
merging.

The server assigns identifiers, timestamps, and `origin: "chatgpt"`, writes the
place, computes a proposal, and returns an explanation. A supplied HTTPS source
URL becomes “Visit source.” The UI always derives “Open in Maps” links locally
from the place name, locality, and coordinates when available.

### Optimize without silently changing the plan

Adding or updating a place, changing destination context, or changing preferences
recomputes a pending proposal in the same request. Calling `optimizeTrip` performs
the same calculation on demand. This is the initial “background optimization”:
no separate worker, timer, or OpenAI model call is required.

The proposal is immediately visible on the website after its normal SWR
revalidation and is also returned to the GPT. The user may accept it in the
website or explicitly ask the GPT to apply it. If any intervening edit changes the
trip version, the proposal becomes stale and must be regenerated.

### Load and refresh shared state

The browser continues to read the URL fragment after hydration and sends it only
in the browser trip API Authorization header. SWR refreshes while visible and on
focus/reconnection, so GPT-originated changes appear without a page reload. A
successful validated trip response updates the versioned IndexedDB snapshot.

Offline snapshots remain read-only. Invalid cached data is deleted. Mutations are
disabled until connectivity and a successful current trip read return.

### Load conditions and rank saved places

The client starts trip and condition requests in parallel once destination
coordinates are available. Conditions refresh at most every 15 minutes. Device
location is requested only after a user gesture, remains in memory, and affects
distance scoring only in that browser.

When condition data is degraded, available fields score and missing fields use
neutral values. When unavailable, Today still ranks saved places using preference,
time, and optional distance. Conditions are advisory and never assert venue
status or personal safety.

## User Interface Design

The visual system remains warm, playful, accessible, and mobile-first. The
primary navigation uses **Today**, **Ideas**, and **Plan**.

Place cards are content-first rather than photo-first. Each card shows:

- name, locality, summary, and relevant tags;
- recommendation reasons or scheduling state;
- an optional “Visit source” link;
- guaranteed Apple Maps and Google Maps search actions;
- an understated origin label such as “Added from ChatGPT”; and
- no empty image frame when artwork is absent.

The Ideas view searches saved place names, localities, summaries, and tags. Its
filters use supported interest, cost, duration, profile, accessibility, and
favorite fields. The Plan view presents pending optimization proposals above the
day-by-day itinerary with clear **Apply** and **Dismiss** controls. Applying a
proposal identifies every proposed change before confirmation.

All controls maintain 44×44 px minimum touch targets, visible keyboard focus,
reduced-motion support, and WCAG AA contrast. Outbound links open only after a
user gesture and use `noopener noreferrer`.

## PWA and Offline Behavior

The service worker caches immutable application assets, navigations, public
condition responses, and the offline fallback. It does not require or cache
place images. Authenticated trip and Action responses are never placed in the
service-worker Cache API.

The client stores only validated trip snapshots in IndexedDB under a hashed-token
key. Offline mode can inspect saved places, source labels, itinerary items, and
the last condition snapshot. External links are labeled as requiring connectivity;
writes are not queued.

## Security and Privacy

- `TRIP_GPT_ACTION_KEY` is a server-only random secret of at least 32 bytes. The
  same value is entered in the Custom GPT Action authentication settings.
- Action-key and trip-token comparisons use constant-time comparison after basic
  format validation. Missing or malformed credentials fail before storage reads.
- Neither secret appears in paths, queries, response bodies, app logs, analytics,
  browser persistence, or service-worker cache keys.
- Action and browser bodies are limited to 64 KiB and reject unknown fields.
- GPT-supplied text renders only as text. Rich HTML is not accepted.
- Optional source URLs are parsed, restricted to HTTPS, and opened only after a
  user gesture. The server does not fetch them, preventing server-side request
  forgery in this release.
- The Action API exposes an allowlist of semantic operations and no delete-trip
  capability. Applying plan changes requires a current proposal and explicit
  user approval in the conversation or UI.
- The Custom GPT must remain private for the initial release. OAuth and broader
  distribution require a new HLD decision.

## Error and Edge-Case Behavior

| Condition                           | Behavior                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| Missing or invalid Action key       | Return `401 action-auth-invalid`; do not inspect the trip token.                      |
| Missing or invalid trip token       | Return `401 trip-auth-invalid`; never echo the token.                                 |
| Unknown or expired trip             | Return `404 trip-not-found` without revealing storage identifiers.                    |
| Missing place name                  | Return non-retryable `400 validation-failed`.                                         |
| Invalid optional URL or coordinates | Save other valid place data and return a warning describing the discarded field.      |
| Exact duplicate place               | Return the existing place as a successful no-op with a duplicate warning.             |
| Unknown place or proposal ID        | Return non-retryable `404`.                                                           |
| Stale mutation or proposal version  | Return retryable `409 version-conflict` with the current version, not credentials.    |
| Repeated mutation ID                | Return the current successful result without another write.                           |
| Redis unavailable                   | Return retryable `503`; preserve browser drafts and do not claim a save.              |
| Open-Meteo partial failure          | Return `200 degraded` and identify unavailable condition groups.                      |
| Destination coordinates missing     | Return `200 unavailable`; keep condition-independent recommendations.                 |
| Proposal has no useful changes      | Store no pending proposal and return an explanatory message.                          |
| Browser offline during mutation     | Roll back optimistic state, retain the draft, and disable further writes.             |
| Legacy place cannot be migrated     | Render an unavailable placeholder; never crash or silently delete the itinerary item. |

## Performance Design

- The Action API returns concise trip context rather than full cached provider
  payloads.
- Independent condition requests run in parallel and use the existing 15-minute
  server cache.
- The optimizer is a pure in-process function over one small trip document; no
  queue, vector database, or additional datastore is introduced.
- SWR owns live remote state and React derives filters, rankings, Maps URLs, and
  summary values without mirrored effect state.
- No image-loading pipeline, place-search SDK, embedded map, drag-and-drop
  framework, or OpenAI SDK is added for this release.

## Tooling, Build, and Deployment

Pixi remains the local command entrypoint and `package-lock.json` remains the
JavaScript dependency lock. Vercel uses its native npm/Next.js build path.

Required production environment variables are:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `TRIP_GPT_ACTION_KEY`

No `OPENAI_API_KEY` is required because ChatGPT calls the application's Action
API; the application does not call an OpenAI model. No browser-exposed environment
variable contains credentials.

Preview deployment remains the acceptance environment. Production deployment is
a separate explicit action after the conversational flow is validated with the
Custom GPT Action test interface and representative prompts.

## Design Decisions

| Decision                                                            | Rationale                                                                                                | Alternatives                                                 |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Embed custom places in each trip document                           | A trip becomes destination-neutral and self-contained; old links can migrate deterministically.          | Global hardcoded catalog IDs, separate place database.       |
| Use the Action key plus existing trip token                         | The integration is private without granting one credential access to every trip or introducing accounts. | Action key alone, OAuth, token in URL parameters.            |
| Share mutation and repository code across browser and Action routes | Validation, concurrency, and persistence behavior cannot drift between clients.                          | Separate GPT datastore or bespoke write path.                |
| Keep Action operations explicit                                     | Clear operation names and schemas help ChatGPT choose correctly and constrain mutations.                 | One generic mutation endpoint.                               |
| Discard invalid optional enrichment with warnings                   | A bad link should not block saving the place the user requested.                                         | Reject the whole place, accept unsafe URLs.                  |
| Always derive Maps links                                            | Every custom place remains actionable without trusting a supplied website or requiring a place API.      | Require an official site, use a paid place-search provider.  |
| Make optimization synchronous and proposal-based                    | It provides immediate help with no worker infrastructure and protects confirmed choices.                 | Background queue, periodic agent, silent itinerary rewrites. |
| Omit required image data                                            | Arbitrary places render consistently without repetitive, licensed, or stale imagery.                     | Mandatory local or generated images.                         |

## Open Questions

### Resolved

1. The initial Custom GPT is private and uses API-key authentication; OAuth and a
   publicly shared GPT are deferred.
2. The private trip token is supplied in an Action header after the user shares
   the trip link within the conversation.
3. ChatGPT may supply a source URL, but the app validates it, labels it as a
   supplied source, and always offers generated Maps links.
4. Images are optional and no longer part of the place contract.
5. Optimization runs during relevant mutations and creates reviewable proposals;
   it does not require an autonomous worker or an OpenAI API key.

### Deferred

1. User accounts, OAuth, public Custom GPT distribution, and per-user audit
   history require a future HLD revision.
2. Automatic official-site verification, live hours, bookings, traffic-aware
   routing, and paid place-search providers remain outside this release.

## References

- [OpenAI: Getting started with GPT Actions](https://developers.openai.com/api/docs/actions/getting-started)
- [OpenAI: GPT Action authentication](https://developers.openai.com/api/docs/actions/authentication)
