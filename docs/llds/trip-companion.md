# Conversational Trip Companion — Low-Level Design

**Created**: 2026-09-01
**Last updated**: 2026-09-08
**Related HLD**: [Conversational Trip Companion — High-Level Design](../high-level-design.md)

## Context and Design Philosophy

The trip companion is a destination-neutral shared plan. The website owns the
durable trip state and visual experience. Embedded Ask is an authenticated,
read-only AI client that returns narrative advice and reviewable place
suggestions. Only a separate explicit browser mutation can add a suggestion. A
private Custom GPT remains an optional additional client for structured Actions.

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
    └── static Action API key in Authorization header

Next.js application
├── landing and trip creation
├── /trip workspace
│   ├── Today
│   ├── Ideas
│   ├── Plan
│   └── Ask (session-local conversation)
├── /api/trip browser route
├── /api/trip/chat embedded AI route
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
reject an otherwise valid place; the response carries a warning and the UI uses
generated Apple Maps and Google Maps search URLs plus a Google Maps directions
URL based on `name + locality` (or available coordinates). The application does
not fetch, scrape, or web-search for a supplied URL in the initial release.

The `origin` field describes how a place entered the trip, not whether its details
are authoritative. There is no required image field. Existing local artwork may
remain as generic decoration, but saved-place rendering cannot depend on it.

### Private trip catalog

Trip creation occurs only through the `/trips` catalog after shared-password
authentication. The catalog session is a thirty-day HttpOnly, SameSite=Lax
cookie signed from server-only configuration. The registry stores each trip's
metadata and an AES-GCM encrypted copy of its bearer token; raw token storage,
browser persistence, logs, and public route paths are prohibited. Catalog users
can list active and expired records, open or copy a private link, and type
`DELETE` to permanently remove both records. Existing `/trip#token` links stay
accessible to a trusted holder and direct deletion removes the matching catalog
record on a best-effort basis. Existing trips in the same Redis database can be
registered by pasting a known private link; importing reads metadata without
duplicating or mutating the trip. Records encrypted with another key remain
visible and deletable by their hash-derived storage identity, but must be
re-imported before their private link can be opened or copied.

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
checks. The transport-only `add-suggested-place` mutation carries a validated
`SuggestedPlace`; the server normalizes it into the existing internal
`add-place` mutation. The transport-only `add-suggested-places` mutation carries
one to twelve validated suggestions and performs the same conversion for all
non-duplicates in one atomic write. A normalized name/locality duplicate is a
successful no-op.

```ts
type SuggestedPlaceMutation =
  | { type: "add-suggested-place"; suggestion: SuggestedPlace }
  | { type: "add-suggested-places"; suggestions: SuggestedPlace[] };
```

The batch mutation reuses the existing trip response. The client compares the
returned authoritative places with the submitted normalized name/locality keys
to mark each card saved or already present; no parallel batch-result datastore
or endpoint is introduced.

## Embedded Ask Contract

`POST /api/trip/chat` authenticates `Authorization: Bearer <trip-token>` and
uses `x-trip-chat-contract` to select request and response validation. Contract
version three accepts a trimmed 1–8,000 character `message` and an optional
boolean `createCards` field that defaults to `false`; version two and headerless
requests retain the 2,000-character message limit and reject that additive
field. Every version accepts at most eight prior user or assistant text
messages, each 1–2,000 characters, with combined history capped at 8,000
characters. Version-three bodies above 32 KiB and older bodies above 16 KiB are
rejected.

```ts
interface TripChatRequestV3 {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  createCards?: boolean;
}
```

The client never submits a trip document. After authentication, the route loads
the authoritative trip and constructs a compact context containing title,
destination, dates, preferences, capped saved-place IDs and summaries, itinerary
items, and a pending-proposal summary. Each included place carries only its ID,
name, summary, locality, interests, normalized tags, profile, and source URL.
Tokens, internal keys, expiry metadata, and unrelated timestamps are excluded,
and serialized context is capped. For trips above the cap, saved-place matching
is limited to the places that remain in this bounded context.

```ts
interface SuggestedPlace {
  name: string;
  summary: string;
  locality: string | null;
  interests: Interest[];
  tags: string[];
  profile: "indoor" | "outdoor" | "coastal" | "mixed";
  preferredDayparts: Daypart[];
  durationMinutes: number | null;
  costLevel: 0 | 1 | 2 | 3 | null;
  reservationRecommended: boolean | null;
  sourceUrl: string | null;
}

interface TripChatResponse {
  message: string;
  savedPlaceIds: string[];
  suggestions: SuggestedPlace[];
  unresolvedPlaceNames: string[];
  tripVersion: number;
}

interface SavedPlaceSourceCandidate {
  savedPlaceId: string;
  sourceUrl: string;
}

interface TripChatModelResponse {
  message: string;
  savedPlaceIds: string[];
  savedPlaceSources: SavedPlaceSourceCandidate[];
  suggestions: SuggestedPlace[];
  unresolvedPlaceNames: string[];
}
```

Contract version four adds a nullable `scheduledItem` response field with one
saved-place ID, an inclusive trip date, a local `HH:MM` start time, and a
15–1,440-minute duration. The compact context includes the server-resolved
destination-local current date so relative dates resolve deterministically.
Schedule mode accepts a candidate only when it references one authoritative
bounded saved idea and all schedule values validate. It performs no web search
or repository update, and asks for clarification when the request is incomplete
or ambiguous. Version three, version two, and headerless callers retain their
current response shapes.

`SuggestedPlace` remains the transport and storage-adapter name for backward
compatibility, but its product meaning is a generic trip idea. A place, event,
or activity uses the same validated fields: the title is `name`; venue or area
may use `locality`; and dates, times, event character, or other useful supplied
details belong in `summary` and tags. Event-specific persistence fields and a
schema migration are not introduced. Cards never imply live availability or
verification.

All strict Structured Output properties are required; nullable properties
represent optional concepts. The narrative message remains capped at 2,000
characters. Each result array is individually capped at twelve, and the combined
count of valid saved IDs, suggestions, and unresolved names is at most twelve.
The route preserves first-occurrence order within each group, silently removes
duplicates, and excludes unresolved names that normalize to a resolved saved or
suggested place. If the input identifies more than twelve places, the model
accounts for the first twelve and states in `message` that the remaining entries
were not processed.

Saved-place IDs must occur in both the bounded context and authoritative trip.
Suggestions are unique by normalized name/locality and cannot duplicate an
authoritative place. Source candidates are unique by saved-place ID and capped
at twelve. The route accepts a saved-place source only when the ID is a valid
returned match, the authoritative place still has no source URL, and the exact
HTTPS URL occurs in the current response's bounded web-search evidence.

The server separates standard, addition, explicit-card, and link-enrichment
intent. Existing `add`, `save`, `include`, `keep`, or `import` detection retains
addition mode regardless of whether names appear in prose, lines, bullets, or a
table. For a version-three request, `createCards: true` selects explicit-card
mode independently of message wording and takes precedence over inferred
addition mode. Explicit-card mode creates results only for the first twelve
named places, events, or activities in the current message; it does not turn an
open-ended request into recommendations. Addition and explicit-card modes may
return saved IDs and new suggestions together. Both preserve relevant supplied
dates, hours, prices, deals, and character as concise summary text without
presenting volatile details as independently verified. An identifiable
suggestion remains reviewable when no source is found; its `sourceUrl` becomes
null and the UI supplies Maps links.

Link-enrichment intent requires the current message to explicitly request a
link, URL, website, or source for a named saved idea. Phrases such as “find a
link for,” “add the website for,” and “what is the URL for” qualify; merely
mentioning or discussing a saved idea does not. This mode returns authoritative
saved IDs only, performs at most one web search for all named targets, and emits
source candidates only for matched saved ideas whose authoritative `sourceUrl`
is null. It never creates a new suggestion or unresolved-name mutation control.

Saved-place lookup without addition, explicit-card, or link-enrichment intent
retains the existing behavior: up to three ranked authoritative matches suppress
new suggestions and do not trigger link enrichment. General discovery
returns no saved IDs, excludes exact saved duplicates, and returns at most three
new suggestions. Every general-discovery suggestion must carry a non-null HTTPS
URL that exactly matches current web-search evidence; an unsourced or ungrounded
candidate is discarded. URLs found only in context, input, history, or narrative
never count as evidence. In addition or explicit-card mode, an ungrounded
candidate URL is stripped while the otherwise valid suggestion is retained as
Maps-only.

The current browser sends `x-trip-chat-contract: 4`. It receives every
version-three field plus `scheduledItem`. A version-two request receives its prior four-field shape,
three-item caps, required suggestion sources, and saved-match suppression. A
headerless request receives only `message` and up to three sourced suggestions.
This rolling-compatibility rule prevents cached clients from rejecting additive
fields while they age out.

Only in link-enrichment mode, the chat handler applies accepted saved-idea source
URLs in one repository compare-and-set operation. It starts from the latest
complete trip document, changes only `sourceUrl` and the idea/document update
timestamps, and increments the trip version once regardless of how many links
are added. It preserves recent mutation IDs and does not run itinerary
optimization because reference metadata does not affect ranking or scheduling.
On a version conflict, the handler reloads once and retries only candidates whose
ideas still exist and still have no source URL. It never overwrites a URL added
concurrently. If the retry also conflicts, Ask still returns its validated
narrative and saved matches with the latest known `tripVersion`, but does not
claim that a source was persisted.

The injected `TripChatModel` production adapter uses the OpenAI Node SDK,
`responses.parse()` with `zodTextFormat`, `store: false`, and the configured
`OPENAI_MODEL`. Standard and link-enrichment modes keep the 1,600-token output
cap, at most one low-context web-search call, and 20-second timeout. Addition and
explicit-card modes use a 5,000-token cap, at most four low-context web-search
calls, and a 45-second timeout. Every mode uses one model request and exposes no
arbitrary HTTP or mutation tools. Invalid, incomplete, or refused output returns
`502`; timeout returns `504`; missing server configuration or unavailable
model/storage returns `503`.

A suggestion card uses the neutral eyebrow **TRIP IDEA · DETAILS UNVERIFIED**,
renders `Learn more` only for a verified source, and always renders generated
Apple Maps, Google Maps, and Directions links. Individual Add to trip retains
`add-suggested-place`. Add all new sends one versioned
`add-suggested-places` mutation containing 1–12 suggestions. The server
normalizes them in order against the authoritative trip and earlier batch
entries, skips exact name/locality duplicates, and writes all remaining places
atomically with one version increment. An all-duplicate batch is a successful
no-op. A malformed member rejects the mutation before any write. The existing
mutation ID, one-conflict retry, and post-response-loss reconciliation rules
apply to the whole batch. Neither individual nor bulk confirmation schedules a
place.

Chat is limited to twenty-five requests per hashed trip/address pair per ten
minutes and two hundred fifty requests per hashed trip per UTC day. A batch
counts as one request, including when later validation or generation fails. The
daily allowance remains request-based; a weighted token ledger is deferred.
Successful and error responses are `no-store`.

## Custom GPT Action Contracts

Official OpenAI documentation requires a GPT Action to describe its API through
an OpenAPI schema and supports API key or OAuth authentication. This optional
private integration continues to use API key authentication independently of
the embedded OpenAI API integration.

Every Action request requires:

```http
Authorization: Bearer <TRIP_GPT_ACTION_KEY>
```

The Action key proves the caller is the configured integration. The server reads
`TRIP_GPT_TRIP_TOKEN` from its environment to select and authorize the one trip
bound to this private GPT. The trip token is not accepted from the GPT in a path,
query string, header, JSON body, or instructions; it is never returned and is
excluded from logs and caches.

| `operationId`        | Method and endpoint                                   | Input                                                                                              | Success behavior                                                                                               |
| -------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `getTripContext`     | `GET /api/actions/trip`                               | No operation arguments                                                                             | Returns concise trip metadata, preferences, places, itinerary, latest pending proposal, and version            |
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

The checked-in schema uses directly declared path parameters and plain top-level
object request bodies. It does not rely on dynamic header parameters, reusable
parameter `$ref` entries, or `allOf` composition because the Custom GPT Action
importer must be able to discover every operation and input without
general-purpose OpenAPI reference resolution. The schema contains no trip token.

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

The browser retries a confirmed suggestion once after rebasing its semantic
mutation against the authoritative trip returned by a conflict, preserving the
same mutation ID. A second conflict preserves the suggestion card for retry. The GPT
must call `getTripContext` and repeat its requested mutation with a new mutation
ID after a conflict; the server never guesses at conversational intent.

Existing browser rate limits remain. Action reads are limited to 60 and Action
mutations to 30 per hashed Action-key/trip-token pair per minute. Rate-limit keys
expire with their windows. The application never stores raw client IPs or raw
credentials in rate-limit keys.

### Ask about a trip

The Ask tab keeps a version-3 maximum of twelve messages in `sessionStorage`
under a SHA-256-derived trip key and sends only the most recent eight text
messages. User-message content may contain up to 8,000 characters; assistant
narrative remains capped at 2,000. Each assistant message stores up to twelve
combined ranked saved-place IDs, new suggestions, and unresolved names.
Version-1 and version-2 ephemeral chat data is discarded rather than migrated,
so stale three-item schemas cannot reject batch results. Card data is never sent
back as model history. The exact trip token is removed before persistence and is
rejected if submitted to the server.

Ask also provides a browser-tab-local **New chat** action. After native
confirmation, it removes the current trip's version-3 entry (and same-token
legacy entries), clears the visible composer, messages, errors, and suggestion
statuses, and returns to the empty state. Hydration and generation disable the
action. The action never writes shared trip data or another trip's session
entry; canceling confirmation leaves the conversation unchanged.

Dismissing a suggestion is session-local and performs no mutation. Individual
and bulk addition use conflict reconciliation, update SWR and the IndexedDB
snapshot, and add only to Ideas—not the itinerary. Saved matches are read-only
and never add, edit, remove, favorite, or schedule a place. Planning questions
receive narrative guidance that points travelers to the existing Plan proposal
workflow; embedded Ask never creates a `PlanProposal`.

## Primary Behaviors

### Connect a conversation to a trip

The deployment owner binds the private GPT to one trip by storing that trip's
token as `TRIP_GPT_TRIP_TOKEN`. The GPT calls `getTripContext` before the first
mutation and never asks the user for a private trip link. No separate account
connection is introduced.

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

The visual system remains warm, accessible, and mobile-first. Fixed interface
copy uses a direct, warm, mostly-English Spanglish voice: familiar Spanish can
make supporting headings feel natural, but actions, privacy warnings, errors,
and form labels remain unambiguous to an English-speaking traveler. The
primary navigation remains **Today**, **Ideas**, **Plan**, and **Ask** so
existing deep links and learned interaction patterns do not change. This voice
does not modify user-entered text, place names and source text, or
model-generated Ask responses.

Today is a decision surface: it identifies the selected day, plainly states
whether conditions are available, and presents recommendations as options for
that day. Its summary names saved ideas and planned stops directly. Plan is a
schedule surface: it introduces the itinerary as a day-by-day plan, labels
pending optimizer output as suggested changes, and gives empty days a concise
next step to select an existing idea. Neither surface uses aspirational
travel-marketing slogans or metaphors.

Ask owns its composer, loading, error, messages, inline saved-match cards, and
inline suggestion cards. Enter submits, Shift+Enter inserts a newline, and
generation/add controls are disabled offline. A labeled **Create cards**
checkbox sits with the composer. It defaults off, applies only to the next
submitted message, is included as `createCards: true` in that request, and
resets immediately when the client accepts the submission even if generation
later fails. Saved chat history stores only role and text, not the control state.

Saved-match cards resolve IDs against the current authoritative trip in the
browser and display the saved name, existing summary, useful tags, optional
reference, Maps and directions links, and a lightweight **View in Ideas**
action. After successful explicit link enrichment, the client compares
`tripVersion` with its loaded trip and revalidates when the server has a newer
version, so the added **Visit source** link is rendered from refreshed
authoritative trip data rather than a model copy. Saved-match cards expose no
manual mutation or scheduling controls and remain readable offline, with
external links labeled as requiring connection. If a saved idea is no longer
present, its stale session ID renders no card. Suggestion cards provide generated
Apple Maps, Google Maps, and Google Maps directions links before confirmation,
plus a supplied source link when present. They retain explicit **Add to trip**
and session-local **Dismiss** controls and expose saved, duplicate, or retry
states.

When a version-four response contains a valid scheduled item, Ask renders a
plan-confirmation card with the authoritative saved idea, resolved date, local
start time, and duration. **Confirm & add to plan** sends the existing
authenticated versioned `add-itinerary-item` mutation with empty notes and
confirmed status. Existing retry and failure behavior applies; the card does not
assert availability or check timed overlaps.

When an assistant response contains more than one new suggestion, Ask also shows
**Add all new**. Activating it sends one atomic batch mutation and marks each
card saved or already present from the returned authoritative trip. While the
batch is pending, all affected add controls are disabled. A failure or repeated
conflict retains every unsaved card for retry, and response-loss reconciliation
refreshes the trip once before reporting failure. Unresolved names render after
the cards in a compact **Needs clarification** list and expose no mutation
control.

Assistant narrative uses a small allowlisted text formatter rather than raw
HTML. It preserves paragraphs, recognizes simple numbered or bulleted lines,
and turns only HTTPS Markdown links into safe outbound links. All other model
text remains escaped text; raw HTML and non-HTTPS URL schemes are never
interpreted.

Place cards are content-first rather than photo-first. Each card shows:

- name, locality, summary, and relevant tags;
- recommendation reasons or scheduling state;
- an optional “Visit source” link;
- guaranteed Apple Maps, Google Maps search, and Google Maps directions actions;
- an understated origin label such as “Added from ChatGPT”; and
- no empty image frame when artwork is absent.

The Ideas view searches saved place names, localities, summaries, and tags. Its
filters use supported interest, cost, duration, profile, accessibility, and
favorite fields. The Plan view presents pending optimization proposals above the
day-by-day itinerary with clear **Apply changes** and **Not now** controls.
Applying a proposal identifies every proposed change before confirmation.

All controls maintain 44×44 px minimum touch targets, visible keyboard focus,
reduced-motion support, and WCAG AA contrast. Outbound links open only after a
user gesture and use `noopener noreferrer`.

## PWA and Offline Behavior

The service worker caches immutable application assets, navigations, public
condition responses, and the offline fallback. It does not require or cache
place images. Authenticated trip and Action responses are never placed in the
service-worker Cache API.

Service workers are production-only. In a non-production browser session, the
registration helper unregisters any worker left on the local origin by a prior
production build and reloads a currently controlled page once so development
cannot run an obsolete client bundle against current route-handler contracts.
It does not register `/sw.js` or populate application caches in development.

The client stores only validated trip snapshots in IndexedDB under a hashed-token
key. Offline mode can inspect saved places, source labels, itinerary items, and
the last condition snapshot. External links are labeled as requiring connectivity;
writes and chat generation are not queued. Session-local chat remains readable.

## Security and Privacy

- `TRIP_GPT_ACTION_KEY` is a server-only random secret of at least 32 bytes. The
  same value is entered in the Custom GPT Action authentication settings.
- `TRIP_GPT_TRIP_TOKEN` is the server-only token for the single trip bound to the
  private GPT. It is never entered in the GPT editor.
- Action-key and trip-token comparisons use constant-time comparison after basic
  format validation. Missing or malformed credentials fail before storage reads.
- Neither secret appears in paths, queries, response bodies, app logs, analytics,
  browser persistence, or service-worker cache keys.
- `OPENAI_API_KEY` and `OPENAI_MODEL` are server-only. `OPENAI_MODEL` must
  support Responses API Structured Outputs and web search. Model calls configure
  only bounded web search and are not stored by the provider (`store: false`).
- Chat logs contain only event name, request ID, configured model, hashed trip
  identifier, duration, status, and returned token usage—never conversation
  content, raw addresses, tokens, or secrets.
- Version-three chat bodies are limited to 32 KiB; older contracts remain at 16
  KiB. Every contract rejects the exact trip token in content and never renders
  returned content as raw HTML.
- Action and browser bodies are limited to 64 KiB and reject unknown fields.
- GPT-supplied text renders only as text. Rich HTML is not accepted.
- Optional source URLs are parsed, restricted to HTTPS, and opened only after a
  user gesture. The server does not fetch them, preventing server-side request
  forgery in this release.
- Automatic saved-place source enrichment accepts only an exact URL from the
  current bounded web-search evidence, applies it only to a returned
  authoritative saved-place ID with a missing URL, and never follows or fetches
  that URL server-side.
- The Action API exposes an allowlist of semantic operations and no delete-trip
  capability. Applying plan changes requires a current proposal and explicit
  user approval in the conversation or UI.
- The Custom GPT must remain private for the initial release. OAuth and broader
  distribution require a new HLD decision.

## Error and Edge-Case Behavior

| Condition                                         | Behavior                                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Missing or invalid Action key                     | Return `401 action-auth-invalid`; do not access trip storage.                             |
| Missing or invalid configured token               | Return `503 action-unavailable`; never expose the token or configuration value.           |
| Unknown or expired trip                           | Return `404 trip-not-found` without revealing storage identifiers.                        |
| Missing place name                                | Return non-retryable `400 validation-failed`.                                             |
| Invalid optional URL or coordinates               | Save other valid place data and return a warning describing the discarded field.          |
| Exact duplicate place                             | Return the existing place as a successful no-op with a duplicate warning.                 |
| Unknown place or proposal ID                      | Return non-retryable `404`.                                                               |
| Stale mutation or proposal version                | Return retryable `409 version-conflict` with the current version, not credentials.        |
| Repeated mutation ID                              | Return the current successful result without another write.                               |
| Redis unavailable                                 | Return retryable `503`; preserve browser drafts and do not claim a save.                  |
| Open-Meteo partial failure                        | Return `200 degraded` and identify unavailable condition groups.                          |
| Destination coordinates missing                   | Return `200 unavailable`; keep condition-independent recommendations.                     |
| Proposal has no useful changes                    | Store no pending proposal and return an explanatory message.                              |
| Browser offline during mutation                   | Roll back optimistic state, retain the draft, and disable further writes.                 |
| Missing chat configuration                        | Return retryable `503 configuration-unavailable` without configuration values.            |
| Chat allowance exhausted                          | Return retryable `429 rate-limited`.                                                      |
| Standard model timeout                            | Return retryable `504 model-timeout` after 20 seconds.                                    |
| Addition- or explicit-card-mode timeout           | Return retryable `504 model-timeout` after 45 seconds.                                    |
| Invalid, incomplete, or refused AI output         | Return retryable `502 model-invalid-response`; do not expose partial suggestions.         |
| More than twelve identifiable card-mode entries   | Process the first twelve and state that remaining entries were not processed.             |
| Named card-mode entry cannot be identified        | Return its bounded name under Needs clarification without a mutation control.             |
| Card-mode suggestion has no verified source       | Retain a details-unverified card with Maps links and no Learn more action.                |
| Create cards is enabled for an open-ended request | Return narrative guidance without inventing unnamed cards.                                |
| Bulk addition contains malformed suggestion data  | Return non-retryable `400 invalid-mutation`; perform no write.                            |
| Link request names no matching saved idea         | Return narrative clarification and perform no trip mutation.                              |
| Saved-idea source has no current search evidence  | Discard it and leave the saved idea unchanged.                                            |
| Saved idea already has a source URL               | Preserve the existing URL and discard the enrichment candidate.                           |
| Source enrichment conflicts twice                 | Return Ask results using the latest known trip version without claiming a link was saved. |
| Legacy place cannot be migrated                   | Render an unavailable placeholder; never crash or silently delete the itinerary item.     |

## Performance Design

- The Action API returns concise trip context rather than full cached provider
  payloads.
- Independent condition requests run in parallel and use the existing 15-minute
  server cache.
- The optimizer is a pure in-process function over one small trip document; no
  queue, vector database, or additional datastore is introduced.
- SWR owns live remote state and React derives filters, rankings, Maps URLs, and
  summary values without mirrored effect state.
- No image-loading pipeline, place-search SDK, embedded map, or drag-and-drop
  framework is added for this release. The OpenAI SDK remains server-only and is
  isolated from client bundles.

## Tooling, Build, and Deployment

Pixi remains the local command entrypoint and `package-lock.json` remains the
JavaScript dependency lock. Vercel uses its native npm/Next.js build path.

Required production environment variables are:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `TRIP_GPT_TRIP_TOKEN`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

`TRIP_GPT_ACTION_KEY` and `TRIP_GPT_TRIP_TOKEN` are optional and enable the
secondary Custom GPT Action client. Upstash remains required in production.

No browser-exposed environment variable contains credentials.

Preview deployment remains the acceptance environment. Production deployment is
a separate explicit action after the conversational flow is validated with the
Custom GPT Action test interface and representative prompts.

## Design Decisions

| Decision                                                            | Rationale                                                                                                 | Alternatives                                                 |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Embed custom places in each trip document                           | A trip becomes destination-neutral and self-contained; old links can migrate deterministically.           | Global hardcoded catalog IDs, separate place database.       |
| Bind the private GPT to one server-configured trip token            | The model never receives the browser credential and the initial integration remains simple and private.   | Dynamic trip token arguments, OAuth, token in URLs.          |
| Share mutation and repository code across browser and Action routes | Validation, concurrency, and persistence behavior cannot drift between clients.                           | Separate GPT datastore or bespoke write path.                |
| Keep Action operations explicit                                     | Clear operation names and schemas help ChatGPT choose correctly and constrain mutations.                  | One generic mutation endpoint.                               |
| Use one atomic mutation for Add all new                             | A reviewed batch persists as one versioned change or remains retryable, while duplicates are safe no-ops. | Sequential card mutations with partial completion.           |
| Discard invalid optional enrichment with warnings                   | A bad link should not block saving the place the user requested.                                          | Reject the whole place, accept unsafe URLs.                  |
| Always derive Maps links                                            | Every custom place remains actionable without trusting a supplied website or requiring a place API.       | Require an official site, use a paid place-search provider.  |
| Make optimization synchronous and proposal-based                    | It provides immediate help with no worker infrastructure and protects confirmed choices.                  | Background queue, periodic agent, silent itinerary rewrites. |
| Omit required image data                                            | Arbitrary places render consistently without repetitive, licensed, or stale imagery.                      | Mandatory local or generated images.                         |

## Open Questions

### Resolved

1. The initial Custom GPT is private and uses API-key authentication; OAuth and a
   publicly shared GPT are deferred.
2. The private GPT is bound to one trip using the server-only
   `TRIP_GPT_TRIP_TOKEN` environment variable.
3. ChatGPT may supply a source URL, but the app validates it, labels it as a
   supplied source, and always offers generated Maps links.
4. Images are optional and no longer part of the place contract.
5. Optimization runs during relevant mutations and creates reviewable proposals;
   it does not require an autonomous worker and remains separate from embedded
   Ask's narrative-only planning advice.

### Deferred

1. User accounts, OAuth, public Custom GPT distribution, and per-user audit
   history require a future HLD revision.
2. Automatic official-site verification, live hours, bookings, traffic-aware
   routing, and paid place-search providers remain outside this release.

## References

- [OpenAI: Getting started with GPT Actions](https://developers.openai.com/api/docs/actions/getting-started)
- [OpenAI: GPT Action authentication](https://developers.openai.com/api/docs/actions/authentication)
- [OpenAI: Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI: Responses API](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)
