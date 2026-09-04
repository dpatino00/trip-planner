# Conversational Trip Companion — High-Level Design

**Created**: 2026-09-01
**Last updated**: 2026-09-02

## Problem Statement

Travel groups need quick, trustworthy answers to two recurring questions during a
trip: “What should we do now?” and “What is our plan?” Generic search and map
products expose large result sets but do not combine the group's preferences,
trip schedule, current local conditions, and saved decisions into one focused
experience. Maintaining that plan through forms also becomes tedious as ideas
emerge naturally in conversation.

The Trip Companion will be a mobile-first shared trip website with a
conversational control surface. Travelers can tell a private Custom GPT what they
want to add or change; the GPT will translate that intent into structured API
mutations, and the website will remain the visual source of truth. The companion
will support custom destinations and places without depending on destination-
specific catalogs or per-place imagery.

## Goals

- Make a useful recommendation available within seconds of opening the app.
- Support arbitrary trip destinations and traveler-supplied places rather than a
  San Diego-only catalog.
- Let a private Custom GPT read and update a trip through authenticated GPT
  Actions defined by an OpenAPI schema.
- Turn conversational requests into structured place ideas, preferences,
  constraints, and itinerary proposals without requiring repeated form entry.
- Recompute deterministic trip suggestions after relevant mutations using
  weather, marine conditions where applicable, air quality, daylight, traveler
  preferences, place coordinates, and optional on-device proximity.
- Let a trusted travel group share favorites and a day-by-day itinerary without
  creating accounts.
- Give every place a useful external destination through a supplied source URL or
  a generated Maps search link; place imagery is optional.
- Remain useful with weak connectivity by preserving the app shell, saved places, and
  last successfully loaded trip data and conditions.
- Deliver a polished, accessible, installable experience optimized for phones.
- Keep operating cost at zero for expected personal-trip usage by using free
  service tiers and key-free condition data.
- Preserve the repository's Pixi workflow while using Vercel's supported native
  build path for the deployed web application.

## Non-Goals

- Embedding a second chat interface or OpenAI model inside the website in the
  first conversational release.
- Allowing the GPT to edit application code, deploy the website, make bookings,
  purchase anything, or delete a trip.
- Letting automated optimization silently overwrite confirmed itinerary choices.
- Building a persistent job queue or autonomous agent loop; initial optimization
  runs as part of relevant API mutations and stores a proposal for review.
- User accounts, roles, or identity-provider integration.
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
│ conversation         │       │ Today · Ideas · Plan        │
└──────────┬───────────┘       └──────────────┬───────────────┘
           │ GPT Action HTTPS                 │ same-origin HTTPS
           │ OpenAPI + action API key         │
           └──────────────────┬───────────────┘
                              ▼
                 ┌──────────────────────────────┐
                 │ Next.js route handlers       │
                 │ Action API · Trip API        │
                 │ validation · optimizer       │
                 │ conditions adapter           │
                 └──────────────┬───────────────┘
                                │
               ┌────────────────┼──────────────────┐
               ▼                ▼                  ▼
    ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
    │ Upstash Redis    │  │ Open-Meteo APIs  │  │ External place   │
    │ shared trip JSON │  │ weather · air ·  │  │ and Maps links   │
    │ + proposals      │  │ marine           │  │                  │
    └──────────────────┘  └──────────────────┘  └──────────────────┘

Deployment: Pixi task → Vercel CLI → Vercel preview/production
```

The Next.js App Router application will serve the interface, destination-neutral
place data, same-origin trip endpoints, and a small public Action API. The Custom
GPT will use the Action API to read trip context and submit structured additions
or changes. The website and GPT will use the same trip service and persisted trip
document so neither becomes a second source of truth.

The Action API will require a dedicated, revocable integration key configured as
the Custom GPT Action's API-key credential. This key is distinct from an OpenAI
API key and from the browser's private trip link. The initial integration is for
a private, owner-operated GPT; per-user OAuth and publishing the GPT are deferred.
Action operations will be narrow and will not expose trip deletion.

After a relevant mutation, the server will validate and deduplicate the input,
refresh applicable condition inputs, and run deterministic optimization in the
request path. The optimizer will preserve confirmed itinerary items and store
explainable proposals for review. A queue or continuously running agent is not
required for the initial release.

Conversational place data may contain a source URL supplied by ChatGPT. The server
will validate that it is a safe HTTP(S) URL but will not claim that an arbitrary
URL is authoritative. The interface will always be able to generate an external
Maps search link from the place name and locality, so missing imagery or an
official website never blocks a useful card.

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

| Decision | Rationale | Alternatives considered |
| --- | --- | --- |
| Make the website the trip source of truth and ChatGPT a client | The plan stays durable, inspectable, and usable even when ChatGPT is closed; conversation becomes a convenient control surface instead of a second datastore. | Storing the plan only in GPT conversation history, letting GPT edit website files. |
| Support custom places from conversation | Travelers can plan any destination without waiting for a hardcoded catalog. Structured fields keep GPT output testable. | One destination-specific catalog, a mandatory paid place-search API. |
| Use GPT Actions rather than an embedded site chat | OpenAI documents Actions as the bridge from natural language to authenticated REST API calls, and the existing website does not need an OpenAI model call for the first release. | Embedding an OpenAI-powered chat UI, manual copy and paste. |
| Use a dedicated Action API key for the private MVP | It is the smallest supported authentication model for an owner-operated GPT and remains separate from OpenAI and trip-sharing credentials. | No Action authentication, OAuth in the first release. |
| Keep optimization deterministic and proposal-based | Results remain explainable and testable; confirmed plans are not silently rearranged. | An autonomous AI worker that directly rewrites the itinerary. |
| Use Next.js, React, and TypeScript on Vercel | This provides a strong mobile UI foundation, integrated server endpoints, PWA support, and a first-class Vercel deployment path. | FastAPI with templates, separate React and Python applications. |
| Keep Pixi as the repository command entrypoint | Contributors retain one documented workflow for development, tests, builds, and deployment while Vercel uses its supported npm installation pipeline. | Requiring direct npm and Vercel commands, attempting to use Pixi as Vercel's package manager. |
| Use a free Upstash Redis integration | A small versioned JSON document fits key-value storage and enables immediate shared reads and writes with minimal operations. | Browser-only state, URL-encoded state, Vercel Blob, Postgres. |
| Treat one opaque link as the trip credential | A trusted group can collaborate without account or invitation complexity. Keeping the token in the URL fragment reduces accidental disclosure through paths and referrers. | User accounts, separate viewer/editor links, public trip IDs. |
| Support cached, read-only offline access | Travelers retain essential reference information without introducing ambiguous or conflicting offline writes. | Online-only use, queued offline mutations with background merge. |
| Link out to Apple Maps and Google Maps | External navigation is more reliable and avoids map-tile providers, API keys, and a larger client bundle. | Embedded MapLibre, Google Maps SDK. |
| Make place imagery optional | Link-rich text cards work for arbitrary destinations, avoid repetitive imagery, and remove an unnecessary asset pipeline. | Mandatory hosted images, remote hotlinking, generated images for every place. |
| Deploy previews before production | Preview validation reduces deployment risk; production remains an explicit approval step. | Immediate production deployment. |

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
injected as server-only environment variables. The initial release will be
validated as a Vercel preview. A production deployment and automatic Git-based
deployments will be enabled only after preview approval.

## Open Questions

None at the HLD level. The LLD will define the Action operations, trip-selection
credential flow, destination-neutral place fields, proposal lifecycle, and URL
validation rules without expanding this scope.

## References

- [OpenAI GPT Actions overview](https://developers.openai.com/api/docs/actions/introduction)
- [OpenAI GPT Action authentication](https://developers.openai.com/api/docs/actions/authentication)
