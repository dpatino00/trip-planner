# Conversational Trip Companion — High-Level Design

**Created**: 2026-09-01
**Last updated**: 2026-09-07

## Problem Statement

Travel groups need quick, trustworthy answers to two recurring questions during a
trip: “What should we do now?” and “What is our plan?” Generic search and map
products expose large result sets but do not combine the group's preferences,
trip schedule, current local conditions, and saved decisions into one focused
experience. Maintaining that plan through forms also becomes tedious as ideas
emerge naturally in conversation.

The Trip Companion will be a mobile-first shared trip website with an embedded
Ask experience. Travelers can ask for contextual advice and receive reviewable
new-place suggestions without leaving the trip; saved ideas are surfaced when
the traveler explicitly asks about them. Travelers can also paste free-form
prose, lists, or tables naming up to twelve places and review saved matches,
new-place cards, and unresolved names together without reformatting the input.
Only an explicit individual or bulk Add to trip action adds a new place to the
shared plan. The
single narrow exception is source-link enrichment: when Ask returns a saved
place whose source URL is missing, it automatically attaches an exact HTTPS
reference found in its current bounded web search. The shared trip remains the
visual and durable source of truth. A private Custom GPT may continue to use
authenticated Actions as an optional secondary client.

## Goals

- Make a useful recommendation available within seconds of opening the app.
- Support arbitrary trip destinations and traveler-supplied places rather than a
  San Diego-only catalog.
- Let travelers ask an embedded AI for trip-aware narrative advice and discover
  new places without repeating ideas already saved, while supporting explicit
  saved-place and add-to-trip requests.
- Turn an explicit free-form request containing up to twelve named places into
  a complete review set that can mix authoritative saved matches, new
  suggestions, and names requiring clarification.
- Require explicit confirmation before an AI suggestion changes shared state.
- Let travelers confirm generated places individually or add all valid new
  suggestions in one atomic trip update.
- Automatically add a search-grounded reference link to a matched saved place
  when that place has no source URL, without overwriting existing links or
  changing any other place or itinerary field.
- Preserve authenticated Custom GPT Actions as an optional secondary client.
- Turn conversational requests into structured place ideas, preferences,
  constraints, and itinerary proposals without requiring repeated form entry.
- Recompute deterministic trip suggestions after relevant mutations using
  weather, marine conditions where applicable, air quality, daylight, traveler
  preferences, place coordinates, and optional on-device proximity.
- Let a trusted travel group share favorites and a day-by-day itinerary without
  creating accounts.
- Give the two trusted owners a password-protected catalog for creating,
  finding, copying, and deleting managed trips without exposing the trip list.
- Give every saved place and Ask suggestion useful Apple Maps, Google Maps, and
  Google Maps directions links generated from its name, locality, and available
  coordinates; preserve a supplied source URL when present. Place imagery is
  optional.
- Remain useful with weak connectivity by preserving the app shell, saved places, and
  last successfully loaded trip data and conditions.
- Deliver a polished, accessible, installable experience optimized for phones.
- Use direct, warm, mostly-English Spanglish for fixed interface copy so the
  product feels approachable without making core actions ambiguous.
- Bound AI operating cost with per-trip request allowances, compact context, and
  capped model output while retaining free-tier storage and condition data.
- Preserve the repository's Pixi workflow while using Vercel's supported native
  build path for the deployed web application.

## Non-Goals

- Persisting chat history as shared trip data or across browser sessions.
- Adding embeddings, a vector database, background place enrichment, a separate
  search provider, or a second Ask endpoint for saved-place discovery.
- Allowing the embedded model to use tools other than bounded web searches for
  place-reference links, or to directly mutate trip data beyond the server's
  narrowly validated addition of a previously missing saved-place source URL.
- Allowing the GPT to edit application code, deploy the website, make bookings,
  purchase anything, or delete a trip.
- Letting automated optimization silently overwrite confirmed itinerary choices.
- Building a persistent job queue or autonomous agent loop; initial optimization
  runs as part of relevant API mutations and stores a proposal for review.
- User accounts, roles, or identity-provider integration.
- A public trip directory or a password requirement for holders of an existing
  private trip link.
- Live business hours, event listings, reservation availability, booking, or
  traffic-aware route optimization.
- An embedded interactive map or turn-by-turn navigation.
- Push notifications or background location tracking.
- Offline editing or automatic background synchronization.
- Replacing authoritative weather, marine safety, air-quality, or navigation
  services.
- Reworking the existing Python package and CLI beyond changes needed to keep the
  repository's development and quality workflows coherent.

## Target Users

The initial users are the owner of a private Custom GPT and a small, trusted travel
group maintaining a flexible trip. They want to collect ideas in natural
conversation, see the resulting plan on their phones, and understand suggested
changes without manually transferring details between ChatGPT and the website.
They are comfortable treating a private shared link as the credential for their
trip.

The trip and place models will be destination-neutral. A conversationally added
place may include a name, locality, coordinates, notes, categories, scheduling
preferences, and an external source URL. Missing optional enrichment must not
prevent the place from being saved.

## System Architecture Overview

```text
┌──────────────────────┐       ┌──────────────────────────────┐
│ Private Custom GPT   │       │ Next.js progressive web app │
│ optional Actions     │       │ Catalog · Today · Ideas · Plan · Ask │
└──────────┬───────────┘       └──────────────┬───────────────┘
           │ GPT Action HTTPS                 │ same-origin HTTPS
           │ OpenAPI + action API key         │
           └──────────────────┬───────────────┘
                              ▼
                 ┌──────────────────────────────┐
                 │ Next.js route handlers       │
                 │ Action · Trip · Chat APIs    │
                 │ validation · optimizer       │
                 │ conditions adapter           │
                 └──────────────┬───────────────┘
                                │
               ┌────────────────┼──────────────────┐
               ▼                ▼                  ▼
    ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
    │ Upstash Redis    │  │ Open-Meteo APIs  │  │ External place   │
    │ shared trip JSON │  │ weather · air ·  │  │ and Maps links   │
    │ + catalog        │  │ marine           │  │ OpenAI Responses │
    └──────────────────┘  └──────────────────┘  └──────────────────┘

Deployment: Pixi task → Vercel CLI → Vercel preview/production
```

The Next.js App Router application will serve the interface, destination-neutral
place data, same-origin trip and chat endpoints, and a small public Action API.
The chat endpoint authenticates the share token, loads an authoritative compact
trip context containing saved-place IDs and descriptions, and asks the OpenAI
Responses API for narrative advice plus up to three structured new-place
suggestions for general discovery. Saved-place IDs are returned only when the
traveler explicitly asks about saved places, Ideas, the current trip, or adding
named places; exact saved-place duplicates are excluded from discovery results.
A distinct explicit-addition path accepts free-form prose, lists, or tables and
returns a combined review of up to twelve saved matches, new suggestions, and
unresolved names, so an existing match cannot suppress cards for other named
places. User-supplied details such as hours, prices, and deals remain concise,
explicitly unverified summary text; they do not create new persistent place
fields.
A requested saved match with no source URL causes the same request to use its one
bounded web-search call to find an exact HTTPS reference. Every returned
new-place suggestion includes an exact HTTPS reference URL from that search so
the traveler can inspect the source before saving; candidates without credible
search evidence are omitted rather than rendered as unsourced cards during
general discovery. Explicit-addition requests may use up to four bounded
searches and retain identifiable suggestions without a verified reference as
Maps-only cards.

The server validates every returned ID and source against the authoritative trip
and the current response's search evidence. For a matched saved place with a
missing source URL, the server may persist that validated URL automatically with
an atomic, conflict-safe trip update; it never overwrites an existing source URL
and never changes other place or itinerary fields. The model receives no
mutation tool. The browser still sends an explicit, versioned trip mutation only
after a traveler chooses an individual Add to trip action or confirms Add all
new. Bulk confirmation normalizes and deduplicates the suggestions and persists
all valid new places atomically with one trip version increment, preserving
validated source URLs.

Embedded Ask requests advertise the browser response-contract version. This
keeps rolling deployments compatible with an older cached browser bundle: a
legacy request receives the original response fields, while a current request
also receives saved-place matches and the authoritative trip version needed to
refresh automatic source enrichment. Contract version three adds bounded batch
results and unresolved names while version-two and headerless clients continue
to receive their prior three-item shapes.

Ask permits twenty-five requests per hashed trip/address pair per ten minutes
and two hundred fifty requests per hashed trip per UTC day. A batch consumes one
request; the allowance remains request-based rather than token-weighted.

The Action API will require a dedicated, revocable integration key configured as
the Custom GPT Action's API-key credential. This key is distinct from an OpenAI
API key and from the browser's private trip link. The initial private,
owner-operated GPT is bound to one trip by a server-only trip token so the model
never receives the browser credential; per-user OAuth, multi-trip GPTs, and
publishing the GPT are deferred.
Action operations will be narrow and will not expose trip deletion.

After a relevant mutation, the server will validate and deduplicate the input,
refresh applicable condition inputs, and run deterministic optimization in the
request path. The optimizer will preserve confirmed itinerary items and store
explainable proposals for review. A queue or continuously running agent is not
required for the initial release.

Existing conversational place data may omit a source URL. New-place suggestions
from general discovery, however, are returned only with an exact HTTPS URL
present in the current bounded web-search evidence; a URL appearing only in
model narrative is not sufficient. Explicit addition may retain an identifiable
new place without that evidence because the interface always generates Maps
links and labels its details unverified. When Ask matches an existing place with
no source URL, the same evidence rule applies before the server automatically
adds the link and returns the updated authoritative place. If the search
provides no credible exact match or the trip changes concurrently, Ask leaves
the place unchanged.

Each shared trip will be a versioned document in Upstash Redis. The share link
will carry a high-entropy bearer token in its URL fragment, which browsers do not
send in HTTP requests or referrer headers. The client will explicitly present
that token to the trip API; only a cryptographic hash of it will identify the
stored document. The LLD will define how an Action request selects and proves
access to one trip without placing either credential in a public URL.

The PWA will cache static assets and keep the last successful place, trip, and
condition payloads on the device. When offline, users may inspect this cached
state but may not mutate the shared trip. The interface will visibly distinguish
live, stale, and unavailable data.

## Key Design Decisions

| Decision                                                                      | Rationale                                                                                                                                                                                                  | Alternatives considered                                                                                                 |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Make the website the trip source of truth and ChatGPT a client                | The plan stays durable, inspectable, and usable even when ChatGPT is closed; conversation becomes a convenient control surface instead of a second datastore.                                              | Storing the plan only in GPT conversation history, letting GPT edit website files.                                      |
| Support custom places from conversation                                       | Travelers can plan any destination without waiting for a hardcoded catalog. Structured fields keep GPT output testable.                                                                                    | One destination-specific catalog, a mandatory paid place-search API.                                                    |
| Make embedded Ask the primary conversational surface                          | Travelers retain trip context and review suggestions in one mobile flow; the model remains a read-only authenticated client until explicit confirmation.                                                   | Custom GPT Actions only, manual copy and paste.                                                                         |
| Keep chat session-local                                                       | Conversation content is not shared trip state and is limited to the current browser tab, reducing storage and privacy risk.                                                                                | Server-side conversation history, durable browser history.                                                              |
| Rank saved places in the existing structured model response                   | Natural-language requests can reuse saved summaries and normalized tags with one model request; authoritative IDs let the server and UI render current trip data without accepting model-generated copies. | Embeddings, vector search, deterministic keyword ranking, a second model request.                                       |
| Treat explicit multi-place additions as a bounded batch                       | Travelers can paste natural prose without reformatting it, review saved and new places together, and confirm up to twelve additions atomically while ordinary discovery stays concise.                     | Requiring tables, splitting every list into groups of three, automatically saving model output.                         |
| Return only search-grounded new-place suggestions when no saved place matches | Existing decisions remain primary and avoid unnecessary discovery calls; every new suggestion remains inspectable through a clickable source before and after saving.                                      | Always combining saved and new places, accepting unsourced suggestions, treating narrative URLs as evidence.            |
| Automatically enrich a matched saved place that lacks a source URL            | A missing reference link is low-risk metadata that improves the saved card immediately. The server accepts only exact current-search evidence, never overwrites a link, and changes no other trip data.    | Requiring a separate confirmation for every link, background enrichment, allowing the model to mutate arbitrary fields. |
| Use strict Structured Outputs for suggestions                                 | A validated transport shape prevents malformed model data from reaching mutation code, while narrative plan advice avoids a competing proposal schema.                                                     | Free-form extraction, model-created plan proposals.                                                                     |
| Use a dedicated Action API key for the private MVP                            | It is the smallest supported authentication model for an owner-operated GPT and remains separate from OpenAI and trip-sharing credentials.                                                                 | No Action authentication, OAuth in the first release.                                                                   |
| Keep optimization deterministic and proposal-based                            | Results remain explainable and testable; confirmed plans are not silently rearranged.                                                                                                                      | An autonomous AI worker that directly rewrites the itinerary.                                                           |
| Use direct, warm Spanglish for fixed interface copy                          | Bilingual travelers get a more natural, less branded experience while universal controls and privacy language remain immediately understandable.                                                            | Full Spanish localization, English-only copy, or changing model-generated Ask responses.                              |
| Use Next.js, React, and TypeScript on Vercel                                  | This provides a strong mobile UI foundation, integrated server endpoints, PWA support, and a first-class Vercel deployment path.                                                                           | FastAPI with templates, separate React and Python applications.                                                         |
| Keep Pixi as the repository command entrypoint                                | Contributors retain one documented workflow for development, tests, builds, and deployment while Vercel uses its supported npm installation pipeline.                                                      | Requiring direct npm and Vercel commands, attempting to use Pixi as Vercel's package manager.                           |
| Use a free Upstash Redis integration                                          | A small versioned JSON document fits key-value storage and enables immediate shared reads and writes with minimal operations.                                                                              | Browser-only state, URL-encoded state, Vercel Blob, Postgres.                                                           |
| Treat one opaque link as the trip credential                                  | A trusted group can collaborate without account or invitation complexity. Keeping the token in the URL fragment reduces accidental disclosure through paths and referrers.                                 | User accounts, separate viewer/editor links, public trip IDs.                                                           |
| Add a shared-password private catalog                                         | Two trusted owners can manage newly created trips without accounts or a public index. Existing private links remain the collaboration credential.                                                          | Public trip directory, full identity-provider integration.                                                              |
| Support cached, read-only offline access                                      | Travelers retain essential reference information without introducing ambiguous or conflicting offline writes.                                                                                              | Online-only use, queued offline mutations with background merge.                                                        |
| Link out to Apple Maps and Google Maps                                        | External navigation is more reliable and avoids map-tile providers, API keys, and a larger client bundle.                                                                                                  | Embedded MapLibre, Google Maps SDK.                                                                                     |
| Make place imagery optional                                                   | Link-rich text cards work for arbitrary destinations, avoid repetitive imagery, and remove an unnecessary asset pipeline.                                                                                  | Mandatory hosted images, remote hotlinking, generated images for every place.                                           |
| Deploy previews before production                                             | Preview validation reduces deployment risk; production remains an explicit approval step.                                                                                                                  | Immediate production deployment.                                                                                        |

## Quality, Privacy, and Reliability Principles

- The interface will meet WCAG-oriented keyboard, focus, contrast, labeling, and
  reduced-motion expectations at supported mobile and desktop widths.
- Live-condition failures must never make saved places or the itinerary
  unusable; the UI will fall back gracefully and expose freshness.
- Browser geolocation will be optional, processed locally, and neither transmitted
  nor persisted.
- Shared trip data will avoid personally identifying information. Anyone holding
  the private link can read, edit, or delete the trip, and the interface will make
  that trust model clear before sharing.
- The Action key will be stored only in server environment configuration and the
  Custom GPT Action authentication settings, never in browser code or a shared
  trip URL.
- The one-trip GPT's trip token will be stored only in server environment
  configuration and will not appear in GPT instructions or Action arguments.
- The OpenAI key and model name are server-only. Chat requests and responses,
  raw client addresses, and raw share tokens are never logged.
- Chat context excludes credentials, storage keys, expiry metadata, and
  unnecessary timestamps. Submitted content containing the exact trip token is
  rejected.
- GPT-supplied URLs and coordinates will be treated as untrusted inputs. The
  server will validate structure and the interface will label source links rather
  than presenting them as independently verified facts.
- External-condition data is advisory. Marine data will carry its coastal-model
  limitation, and business cards will direct users to verify current hours.
- Automated tests and implementation code will trace back to approved EARS
  requirements before the feature is considered complete.

## Deployment and Operating Model

Development, validation, production builds, and preview deployment will be
available as Pixi tasks. The Pixi environment will provide a supported Node.js
runtime, while npm's lockfile will define JavaScript packages for both local and
Vercel builds.

Vercel will host the Next.js application and route handlers. Upstash will be
provisioned through the Vercel Marketplace on its free tier, with credentials
injected as server-only environment variables. Production also requires an
OpenAI API key and configured model. Chat is limited to ten requests per hashed
trip/address pair per ten minutes and one hundred per hashed trip per UTC day.
The initial release will be validated as a Vercel preview. A production
deployment and automatic Git-based deployments will be enabled only after
preview approval.

## Open Questions

None at the HLD level. The LLD will define the Action operations, trip-selection
credential flow, destination-neutral place fields, proposal lifecycle, and URL
validation rules without expanding this scope.

## References

- [OpenAI GPT Actions overview](https://developers.openai.com/api/docs/actions/introduction)
- [OpenAI GPT Action authentication](https://developers.openai.com/api/docs/actions/authentication)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI Responses API](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)
