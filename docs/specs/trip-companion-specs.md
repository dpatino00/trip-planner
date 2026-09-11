# Conversational Trip Companion Specifications

**Related LLD**: [Conversational Trip Companion — Low-Level Design](../llds/trip-companion.md)
**Last updated**: 2026-09-10

Feature prefixes used in this file:

- `PLC`: destination-neutral saved places and external links
- `TRIP`: shared-trip lifecycle and persistence
- `ACT`: Custom GPT Action contracts and behavior
- `CHAT`: embedded Ask data, API, backend, and interface behavior
- `OPT`: itinerary optimization proposals
- `COND`: live and forecast condition data
- `REC`: recommendation scoring and location assistance
- `EXP`: saved-place Ideas view and favorites
- `PLAN`: itinerary planning
- `APP`: application shell and visual interface
- `PWA`: installation, caching, and offline behavior
- `SEC`: security and privacy
- `OPS`: repository workflow and deployment

`[x]` marks behavior already covered by traced tests and code. `[ ]` marks an
active gap introduced or changed by the approved conversational design.

## Destination-Neutral Places

- [ ] **PLC-DATA-001**: Each place saved inside a schema-version-two trip shall conform to the approved destination-neutral place model.
- [ ] **PLC-DATA-002**: Each saved place shall have a name containing 1–120 characters.
- [ ] **PLC-DATA-003**: Each saved place coordinate pair shall be null or contain finite latitude and longitude values within geographic bounds.
- [ ] **PLC-DATA-004**: Each saved place source URL shall be null or use HTTPS.
- [ ] **PLC-DATA-005**: Each saved place shall remain valid without image data.
- [ ] **PLC-DATA-006**: Each saved place shall contain no more than ten unique lower-case tags of 1–30 characters each.
- [ ] **PLC-DATA-007**: Each known saved-place duration shall be between 15 and 1,440 minutes inclusive.
- [ ] **PLC-DATA-008**: Each newly saved place shall receive a server-assigned identifier.
- [ ] **PLC-BE-001**: If a place-add request contains an invalid optional URL or coordinate pair, then the system shall save the otherwise valid place without that field.
- [ ] **PLC-BE-002**: If the system discards invalid optional place data, then it shall return a warning identifying the discarded field.
- [ ] **PLC-BE-003**: When a place-add request matches an existing normalized name and locality, the system shall return the existing place without creating another place.
- [ ] **PLC-BE-004**: When the system returns an existing place for a duplicate place-add request, it shall include a duplicate warning.
- [x] **PLC-BE-005**: When the system presents a saved place or an Ask suggestion, it shall derive Apple Maps and Google Maps search destinations plus a Google Maps directions destination from the place name, locality, and available coordinates.
- [ ] **PLC-UI-001**: Each saved-place card shall display its name, locality when known, summary, and relevant tags without requiring an image.
- [ ] **PLC-UI-002**: While a saved place has a source URL, its card shall provide a “Visit source” action.
- [x] **PLC-UI-003**: Each saved-place card shall provide Apple Maps, Google Maps, and directions actions.
- [ ] **PLC-UI-004**: While a saved place has ChatGPT origin, its card shall identify that origin without claiming the place details are verified.
- [ ] **PLC-UI-005**: While a saved place has no image, its card shall omit the image region rather than display an empty placeholder.

## Shared-Trip Data and Browser API

- [ ] **TRIP-DATA-001**: Each current shared-trip document shall conform to schema version two of the approved destination-neutral trip model.
- [ ] **TRIP-DATA-002**: Each shared trip shall have a title containing 1–80 characters.
- [ ] **TRIP-DATA-003**: When a shared trip is created without customized preferences, the system shall use balanced pace, standard mobility, maximum cost level 2, and outdoors, food, culture, and relaxing interests.
- [ ] **TRIP-DATA-006**: Each itinerary item in a shared trip shall use a date inside that trip's date range.
- [x] **TRIP-DATA-008**: Each shared trip shall expire at the later of 30 days after creation or 180 days after its end date.
- [x] **TRIP-DATA-009**: When a shared trip is mutated, the system shall preserve its original absolute expiration time.
- [ ] **TRIP-DATA-010**: Each persisted schema-version-two trip document shall exclude the raw share token, Action key, browser location, referrer, and client IP address.
- [ ] **TRIP-DATA-011**: Each place identifier stored in a schema-version-two favorite or itinerary item shall resolve to a place embedded in that trip.
- [ ] **TRIP-DATA-012**: Each schema-version-two trip shall retain no more than three plan proposals.
- [ ] **TRIP-DATA-013**: When a schema-version-one trip is read, the system shall deterministically convert its known catalog and custom itinerary references into embedded schema-version-two places.
- [ ] **TRIP-DATA-014**: When a schema-version-one trip is migrated, the system shall mark its existing itinerary items as confirmed.
- [ ] **TRIP-DATA-015**: When a migrated trip next completes a successful mutation, the system shall persist it as schema version two without rotating its share link.
- [ ] **TRIP-DATA-016**: If a schema-version-one place reference cannot be migrated, then the system shall retain an unavailable placeholder rather than discard the itinerary entry.
- [ ] **TRIP-DATA-017**: Each shared trip shall have an inclusive date range of 1–31 days.
- [ ] **TRIP-DATA-018**: Each shared trip shall have a destination name containing 1–120 characters.
- [ ] **TRIP-API-001**: When a valid destination-neutral trip-creation request is received through an authenticated private catalog, the system shall return status 201 with a new share token and schema-version-two trip.
- [ ] **TRIP-API-002**: When a valid share token identifies an unexpired trip, the browser trip API shall return status 200 with the current schema-version-two trip.
- [ ] **TRIP-API-003**: When a valid browser semantic mutation targets the current trip version, the browser trip API shall return status 200 with the updated trip.
- [x] **TRIP-API-004**: When a valid deletion confirmation targets an existing shared trip, the browser trip API shall permanently delete it and return status 204.
- [x] **TRIP-API-005**: If a browser trip request has a missing or malformed bearer token, then the browser trip API shall return status 401 without accessing trip storage.
- [x] **TRIP-API-006**: If a valid share token does not identify an unexpired trip, then the browser trip API shall return status 404.
- [ ] **TRIP-API-007**: If a browser trip request contains an invalid body, unknown field, or unresolved embedded-place reference, then the browser trip API shall return status 400 with a non-retryable error.
- [x] **TRIP-API-008**: The browser trip API shall mark every response as non-cacheable by shared and browser HTTP caches.
- [x] **TRIP-API-009**: If trip storage is unavailable, then the browser trip API shall return status 503 with a retryable error.
- [x] **TRIP-API-011**: If one hashed token-and-client pair reads a trip more than 120 times within one minute, then the browser trip API shall reject subsequent reads with status 429 until that window expires.
- [x] **TRIP-API-012**: If one hashed token-and-client pair mutates a trip more than 60 times within one minute, then the browser trip API shall reject subsequent mutations with status 429 until that window expires.
- [x] **TRIP-BE-001**: When the system creates a shared trip, it shall generate a URL-safe token containing 128 bits of cryptographic randomness.
- [x] **TRIP-BE-002**: When the system identifies a persisted shared trip, it shall use a cryptographic hash of the share token rather than the raw token.
- [ ] **TRIP-BE-003**: When either the browser or Action trip API receives a previously applied mutation identifier, it shall return the current result without applying the mutation again.
- [ ] **TRIP-BE-004**: When either the browser or Action trip API commits a mutation, it shall atomically verify the expected version and increment the trip version.
- [ ] **TRIP-BE-005**: If either the browser or Action trip API receives a mutation for a stale trip version, then it shall return status 409 without applying that mutation.
- [x] **TRIP-BE-006**: When the browser receives its first version conflict for a semantic mutation, it shall reapply that mutation to the latest trip and retry once.
- [x] **TRIP-BE-007**: If the retried browser mutation conflicts again, then the browser shall preserve the user's draft and require a refresh before another submission.
- [x] **TRIP-BE-008**: When a shared trip adds an existing favorite or removes an absent favorite, the operation shall succeed without duplicating or failing the favorite state.
- [x] **TRIP-UI-001**: Before creating a shared trip through the private catalog, the onboarding interface shall explain that anyone holding its private link can view, edit, and delete the trip.
- [ ] **TRIP-UI-002**: The destination-neutral onboarding interface shall collect a trip title, date range, destination name, preferences, and optional home base.
- [x] **TRIP-UI-003**: When a shared trip is successfully created through the private catalog, the system shall navigate to `/trip` with the share token in the URL fragment.
- [x] **TRIP-UI-004**: When a user shares a trip, the system shall use native device sharing when available and otherwise provide a clipboard-copy action.
- [ ] **TRIP-UI-005**: The shared-trip interface shall provide a “Copy link for ChatGPT” action that copies the existing private trip link.
- [x] **TRIP-UI-006**: Before deleting a shared trip, the system shall require confirmation that deletion is permanent for everyone holding the link.
- [ ] **TRIP-UI-007**: Before copying a private trip link for ChatGPT, the system shall explain that anyone holding the link can edit the trip.
- [x] **TRIP-NAV-001**: When `/trip` loads with a valid share-token fragment, the browser shall authenticate trip API requests with that fragment only after hydration.
- [x] **TRIP-NAV-002**: If `/trip` loads without a valid share-token fragment, then the browser shall avoid a trip API request and display actions to paste a complete link or open the private catalog.

## Private Trip Catalog

- [x] **CAT-DATA-001**: The private catalog shall retain each managed trip's metadata, hash-derived identity, and AES-GCM-encrypted bearer token without persisting the raw token in browser storage or unencrypted registry data.
- [x] **CAT-DATA-002**: When a catalog trip is created, the system shall best-effort resolve its destination name to coordinates and retain the trip if the external location lookup is unavailable.
- [x] **CAT-API-001**: When a visitor supplies the configured shared password, the catalog API shall issue a thirty-day HttpOnly SameSite=Lax signed session cookie.
- [x] **CAT-API-002**: If a catalog request lacks a valid unexpired session, then the catalog API shall return status 401 without reading or returning catalog data.
- [x] **CAT-API-003**: When an authenticated catalog user creates a valid trip, the system shall persist the trip and catalog record or roll back the trip if catalog registration fails.
- [x] **CAT-API-004**: When an authenticated catalog user confirms deletion by submitting `DELETE`, the system shall permanently delete the selected trip and its catalog record.
- [x] **CAT-API-005**: When an authenticated catalog user imports a valid private link for an existing unexpired trip, the system shall register its current metadata without duplicating or mutating the trip.
- [x] **CAT-BE-001**: The private catalog shall list every record created through the catalog in newest-updated order and identify expired records.
- [x] **CAT-BE-002**: When a private-link trip deletion succeeds, the system shall remove its matching catalog record without blocking the completed deletion if catalog cleanup is unavailable.
- [x] **CAT-BE-003**: The public browser trip API shall reject direct trip-creation requests and preserve bearer-token read, mutation, and deletion behavior.
- [x] **CAT-BE-004**: If a catalog record cannot be decrypted with the configured key, then the catalog shall keep it visible without open or copy actions and shall allow its trip and registry data to be deleted by hash-derived identity.
- [x] **CAT-SEC-001**: The catalog password, session secret, and encryption key shall be server-only runtime configuration and shall fail closed when absent.
- [x] **CAT-SEC-002**: The catalog session cookie shall be HttpOnly, SameSite=Lax, signed, and Secure in production.
- [x] **CAT-SEC-003**: The catalog shall decrypt a stored bearer token only in server memory to fulfill an authenticated catalog request or deletion.
- [x] **TRIP-NAV-003**: If a shared trip is missing or expired, then the browser shall clear its matching local snapshot and display a recoverable not-found state.

## Custom GPT Actions

- [ ] **ACT-DATA-001**: The checked-in Custom GPT Action schema shall describe only the approved Action API operations and their accepted fields using directly declared path parameters and plain top-level object request bodies that the Custom GPT Action importer can discover without dynamic header parameters, parameter references, or composed request bodies.
- [ ] **ACT-DATA-002**: Each Custom GPT Action operation shall have a unique stable operation identifier.
- [ ] **ACT-DATA-003**: Each Custom GPT Action operation shall have an explicit description of its purpose.
- [ ] **ACT-DATA-004**: The checked-in Custom GPT instructions shall tell the GPT that its Action API is already bound to one trip and shall not request a private trip link.
- [ ] **ACT-DATA-005**: The checked-in Custom GPT Action schema and instructions shall exclude the private trip token from model-visible arguments and configuration text.
- [ ] **ACT-DATA-006**: The checked-in Custom GPT instructions shall tell the GPT to retrieve current trip context before its first mutation.
- [ ] **ACT-DATA-007**: The `applyPlanProposal` Action description shall permit invocation only after the user explicitly accepts the identified proposal.
- [ ] **ACT-API-001**: When an Action request contains a valid bearer Action API key and production has a valid server-configured Action trip token, the Action API shall authenticate the request for only that configured trip.
- [ ] **ACT-API-002**: If an Action request has a missing or invalid Action API key, then the Action API shall return status 401 without accessing trip storage.
- [ ] **ACT-API-003**: If the server-configured Action trip token is missing or malformed, then the Action API shall fail closed without accessing trip storage or exposing configuration values.
- [ ] **ACT-API-004**: If a valid Action request identifies no unexpired trip, then the Action API shall return status 404 without revealing a storage identifier.
- [ ] **ACT-API-005**: When `getTripContext` authenticates successfully, the Action API shall return concise trip metadata, destination, preferences, places, itinerary, latest pending proposal, and current version.
- [ ] **ACT-API-006**: When `setTripDestination` receives valid destination data for the current version, the Action API shall persist that destination and return the updated destination.
- [ ] **ACT-API-007**: When `addPlace` receives a valid place for the current version, the Action API shall persist one ChatGPT-origin place and return it.
- [ ] **ACT-API-008**: When `updatePlace` receives valid allowlisted changes for an existing place at the current version, the Action API shall persist and return the updated place.
- [ ] **ACT-API-009**: When `setTripPreferences` receives valid preferences for the current version, the Action API shall replace and return the trip preferences.
- [ ] **ACT-API-010**: When `optimizeTrip` receives the current version, the Action API shall return the newly calculated pending proposal or an explanation that no proposal is useful.
- [ ] **ACT-API-011**: When `applyPlanProposal` receives a valid current proposal for the current trip version, the Action API shall atomically apply that proposal and return the updated version.
- [ ] **ACT-API-012**: The Custom GPT Action API shall expose no operation that deletes a trip.
- [ ] **ACT-API-013**: Each successful Action response shall exclude the Action key, trip token, storage key, and raw condition-provider responses.
- [ ] **ACT-API-014**: The Action API shall mark every response as non-cacheable by shared and browser HTTP caches.
- [ ] **ACT-API-015**: If an Action request body exceeds 64 KiB or contains an unknown field, then the Action API shall return status 400 before mutating the trip.
- [ ] **ACT-API-016**: If one hashed Action-key-and-trip-token pair reads a trip more than 60 times within one minute, then the Action API shall reject subsequent reads with status 429 until that window expires.
- [ ] **ACT-API-017**: If one hashed Action-key-and-trip-token pair mutates a trip more than 30 times within one minute, then the Action API shall reject subsequent mutations with status 429 until that window expires.
- [ ] **ACT-BE-001**: When an Action mutation succeeds, the system shall run the same schema validation, idempotency, concurrency, and persistence behavior used by browser mutations.
- [ ] **ACT-BE-002**: If an Action mutation targets a stale trip version, then the system shall return status 409 with the current version and without guessing how to reapply the conversational request.
- [ ] **ACT-BE-003**: When a valid Action place-add, place-update, destination-update, or preference-update mutation succeeds, the system shall recalculate the pending plan proposal before returning.

## Embedded Ask Data and API

- [x] **CHAT-DATA-001**: Each embedded Ask trip-idea suggestion for a place, event, or activity shall contain the required name, concise one- or two-sentence descriptive summary, nullable locality, unique valid interests, no more than ten unique normalized lower-case tags, profile, unique valid dayparts, nullable duration, nullable cost, nullable reservation recommendation, and nullable HTTPS source URL fields.
- [x] **CHAT-DATA-002**: The version-3 embedded Ask response shall contain a message of no more than 2,000 characters, individually bounded arrays of no more than twelve unique ranked saved-place IDs, new-place suggestions, and unresolved place names, no more than twelve combined valid results across those arrays, and the authoritative positive trip version at response completion.
- [x] **CHAT-DATA-003**: The embedded Ask model context shall include IDs, summaries, and normalized tags for each saved place retained in the bounded authoritative trip details while excluding share tokens, storage identifiers, expiry metadata, and unnecessary timestamps.
- [x] **CHAT-DATA-004**: The embedded Ask browser shall retain no more than twelve version-3 messages with user content bounded to 8,000 characters, assistant content bounded to 2,000 characters, and result arrays bounded to twelve combined entries in session storage under a SHA-256-derived trip key that excludes the raw token, and shall discard version-1 and version-2 data.
- [x] **CHAT-DATA-005**: Each general-discovery suggestion shall contain a non-null HTTPS source URL, each explicit-addition or explicit-card suggestion may contain a nullable HTTPS source URL, and shared saved-place and Action schemas shall remain compatible with nullable source URLs.
- [x] **CHAT-DATA-006**: The embedded Ask model response shall contain no more than twelve unique saved-place source candidates, each pairing a saved-place ID with an HTTPS source URL.
- [x] **CHAT-DATA-007**: Each unresolved place name in an embedded Ask response shall contain 1–120 characters and shall be unique under normalized name comparison.
- [x] **CHAT-DATA-008**: The embedded Ask model history shall contain no more than eight role-and-text-only messages of no more than 2,000 characters each and 8,000 characters combined, excluding stored saved-place IDs, suggestions, and unresolved place names.
- [x] **CHAT-DATA-009**: When a traveler confirms starting a new Ask chat, the browser shall remove only the current trip's version-3 session entry and same-token legacy entries, without changing shared trip data or another trip's session entry.
- [x] **CHAT-DATA-010**: When a version-4 Ask request is processed, the compact authoritative model context shall include the server-resolved current calendar date in the destination time zone for relative-date interpretation.
- [x] **CHAT-DATA-011**: Each version-4 Ask response shall include a nullable scheduled item containing one authoritative saved-place ID, an inclusive trip date, a local HH:MM start time, and a 15–1,440-minute duration.
- [x] **CHAT-DATA-012**: The embedded Ask browser shall store version-4 chat messages and discard version-1 through version-3 tab-local session entries for the same trip.
- [x] **CHAT-DATA-013**: Each version-5 Ask response schedule candidate shall contain one inclusive trip date, one local HH:MM start time, one 15–1,440-minute duration, and exactly one of an authoritative saved-place ID or a validated suggested place.
- [x] **CHAT-DATA-014**: The embedded Ask browser shall store version-5 chat messages and discard version-1 through version-4 tab-local session entries for the same trip.
- [x] **CHAT-API-001**: When the version-3 embedded Ask API receives a valid bearer token, a 1–8,000 character message, no more than eight bounded history messages, and an optional boolean `createCards` value, the system shall load the authoritative trip and return a no-store validated Ask response.
- [x] **CHAT-API-002**: If the embedded Ask API receives missing or malformed bearer authentication, then the system shall return status 401 before reading trip storage.
- [x] **CHAT-API-003**: If the embedded Ask API receives an unknown or expired trip token, then the system shall return status 404.
- [x] **CHAT-API-004**: If a version-3 embedded Ask request exceeds 32 KiB, an older-contract request exceeds 16 KiB, or any request violates its message, history-count, per-item, combined-history, or unknown-field constraints, then the system shall return status 413 or 400 without calling the model.
- [x] **CHAT-API-005**: If embedded Ask content contains the exact authenticated trip token, then the system shall return status 400 without calling the model.
- [x] **CHAT-API-006**: If one hashed trip/address pair makes more than twenty-five embedded Ask requests in ten minutes, then the system shall return status 429 for subsequent requests in that window.
- [x] **CHAT-API-007**: If one hashed trip makes more than two hundred fifty embedded Ask requests in one UTC day, then the system shall return status 429 for subsequent requests that day.
- [x] **CHAT-API-008**: If embedded Ask storage or model service is unavailable or required model configuration is absent, then the system shall return status 503 without exposing configuration values.
- [x] **CHAT-API-009**: If a standard or link-enrichment embedded Ask model request exceeds twenty seconds or an explicit-addition or explicit-card request exceeds forty-five seconds, then the system shall return status 504.
- [x] **CHAT-API-010**: If the embedded Ask model refuses, returns incomplete output, or returns output that fails the strict response schema, then the system shall return status 502 without returning partial model output.
- [x] **CHAT-API-011**: When explicit link enrichment completes successfully, embedded Ask shall return the authoritative trip version after any saved-idea source update in the no-store response.
- [x] **CHAT-API-012**: When an embedded Ask request advertises contract version 3, the system shall return the message, saved-place IDs, suggestions, unresolved place names, and authoritative trip version; when it advertises version 2, the system shall return the version-2 four-field shape and enforce its three-result limits; and when it advertises no version, the system shall return the strict legacy shape without additive fields.
- [x] **CHAT-API-013**: When an embedded Ask request advertises contract version 2 or no version, the system shall reject `createCards` as an unknown field and preserve the older request contract.
- [x] **CHAT-API-014**: When an embedded Ask request advertises contract version 4, the system shall return every version-3 response field plus a nullable scheduled item while version-3, version-2, and headerless responses preserve their current shapes.
- [x] **CHAT-API-015**: When an embedded Ask request advertises contract version 5, the system shall return every version-3 response field plus a nullable schedule candidate while version-4 and older responses preserve their current shapes.
- [x] **CHAT-BE-001**: When generating a standard or link-enrichment embedded Ask response, the system shall configure at most one low-context web-search call and a 1,600-token output cap, and when generating an explicit-addition or explicit-card response, it shall configure no more than four low-context web-search calls and a 5,000-token output cap, while every mode shall disable provider storage and configure no other tools.
- [x] **CHAT-BE-002**: When embedded Ask handles a request, the system shall perform no trip repository create or delete operation and no update except validated source enrichment for a named saved idea during explicit link-enrichment mode.
- [x] **CHAT-BE-003**: When embedded Ask receives an itinerary-planning question, the system shall return narrative guidance for the existing Plan proposal workflow without creating a plan proposal.
- [x] **CHAT-BE-004**: When a valid embedded Ask suggestion is explicitly confirmed, the system shall normalize it through the shared place factory, set `origin` to `chatgpt`, and add it to saved places without adding an itinerary item.
- [x] **CHAT-BE-005**: When an embedded Ask suggestion matches a saved place by normalized name and locality, the system shall return the authoritative trip without adding another place or itinerary item.
- [x] **CHAT-BE-006**: If the first confirmed-suggestion mutation conflicts, then the browser shall retry once against the returned authoritative trip with the same mutation identifier.
- [x] **CHAT-BE-007**: If the confirmed-suggestion mutation conflicts twice, then the browser shall retain the suggestion for another explicit retry.
- [x] **CHAT-BE-008**: When embedded Ask completes a model request, the system shall log only request metadata, hashed trip identity, duration, status, configured model, and returned token usage.
- [x] **CHAT-BE-009**: When a general-discovery request has no valid saved-place match, embedded Ask shall return only new-place candidates whose non-null source URL exactly matches an HTTPS URL in the current response's bounded web-search evidence, silently discarding all other candidates.
- [x] **CHAT-BE-010**: When the traveler explicitly asks about saved places, Ideas, or the current trip without requesting additions, cards, or link enrichment and the model finds useful saved places, embedded Ask shall return at most three IDs in relevance order, return no new suggestions, and perform no saved-idea source update.
- [x] **CHAT-BE-011**: When a saved-place lookup receives model-ranked saved-place IDs, the system shall preserve their first-occurrence order, silently discard duplicates and IDs outside both the bounded context and authoritative trip, and suppress all new-place suggestions if at least one valid ID remains.
- [x] **CHAT-BE-012**: When a general-discovery model response contains no useful saved place from the bounded context, embedded Ask shall return no saved-place IDs, invoke no more than one bounded bulk web search, and return no new-place suggestion unless that search supplies its verified source URL.
- [x] **CHAT-BE-013**: If a proposed trip-idea or saved-idea source URL lacks an exact match in the current bounded web-search evidence, then embedded Ask shall discard that source candidate and shall retain the proposed new idea without a source URL only in explicit-addition or explicit-card mode.
- [x] **CHAT-BE-014**: When a traveler confirms a sourced embedded Ask suggestion, the system shall preserve its validated source URL unchanged on the saved place without scheduling the place.
- [x] **CHAT-BE-015**: When explicit link-enrichment mode receives a saved-idea source candidate, the system shall accept it only when its ID is a valid returned saved-idea match, the authoritative idea has no source URL, and its exact HTTPS URL occurs in the current response's bounded web-search evidence.
- [x] **CHAT-BE-016**: When explicit link-enrichment mode accepts one or more saved-idea source candidates, the system shall atomically add all still-missing URLs, update only the affected idea timestamps and document timestamp, increment the trip version once, and preserve recent mutation IDs.
- [x] **CHAT-BE-017**: If the first explicit saved-idea source update conflicts, then embedded Ask shall reload the authoritative trip and retry once only for matched ideas that still exist and still lack a source URL.
- [x] **CHAT-BE-018**: If an explicit saved-idea source candidate targets an idea that already has a URL or conflicts twice, then embedded Ask shall preserve the existing trip fields, never overwrite a source URL, and return the latest known authoritative trip version without claiming the candidate was saved.
- [x] **CHAT-BE-019**: When embedded Ask explicitly enriches saved-idea source URLs, the system shall not add or remove ideas, change itinerary items, or recalculate a plan proposal.
- [x] **CHAT-BE-020**: For general discovery requests, embedded Ask shall omit saved-idea matches and exact duplicates of authoritative saved ideas, and it shall return saved-idea IDs only for saved-idea lookups, explicit-addition requests, explicit-card requests, or explicit link-enrichment requests.
- [x] **CHAT-BE-021**: When the current user message uses an add, save, include, keep, or import instruction for named places, embedded Ask shall select explicit-addition mode independently of whether the names appear in prose, a list, or a table.
- [x] **CHAT-BE-022**: When explicit-addition mode resolves requested places, embedded Ask shall return a non-mutating mixture of authoritative saved-place IDs, new-place suggestions, and unresolved place names with at most twelve combined results while preserving first-occurrence order within each result group.
- [x] **CHAT-BE-023**: When explicit-addition mode creates a suggestion from user-provided hours, prices, or deals, embedded Ask shall preserve those useful details in its concise summary without claiming that the details are verified.
- [x] **CHAT-BE-024**: When an explicit-addition request names more than twelve places, embedded Ask shall process the first twelve place occurrences, omit normalized duplicates from later result groups, and explain the overflow in its narrative message.
- [x] **CHAT-BE-025**: When a valid bulk confirmed-suggestion mutation contains one to twelve suggestions, the system shall normalize and deduplicate the batch against itself and authoritative saved places, add every remaining place atomically without scheduling it, and increment the trip version no more than once.
- [x] **CHAT-BE-026**: When every suggestion in a valid bulk confirmed-suggestion mutation is already saved, the system shall return the authoritative trip and duplicate results without writing or incrementing the trip version.
- [x] **CHAT-BE-027**: If the first bulk confirmed-suggestion mutation conflicts, then the browser shall retry the complete mutation once against the returned authoritative trip with the same mutation identifier and shall retain every unsaved suggestion if the retry also conflicts.
- [x] **CHAT-BE-028**: If a bulk confirmed-suggestion response is lost, then the browser shall revalidate the authoritative trip once and shall report success only when every submitted suggestion is present by normalized name and locality.
- [x] **CHAT-BE-029**: When a version-3 embedded Ask request sets `createCards` to true, the system shall select explicit-card mode independently of message wording and ahead of inferred addition mode.
- [x] **CHAT-BE-030**: When explicit-card mode receives named places, events, or activities, embedded Ask shall return a non-mutating mixture of authoritative saved-idea IDs, new trip-idea suggestions, and unresolved names for the first twelve named occurrences while returning no invented card for an open-ended unnamed request.
- [x] **CHAT-BE-031**: When the current user message explicitly requests a link, URL, website, or source for a named saved idea, embedded Ask shall select link-enrichment mode, return only authoritative saved-idea matches and grounded source candidates, and perform no new-idea suggestion.
- [x] **CHAT-BE-032**: When a traveler mentions a saved idea without explicitly requesting its link, URL, website, or source, embedded Ask shall not enrich that idea's source URL.
- [x] **CHAT-BE-033**: When a version-4 message explicitly asks to schedule one saved idea, embedded Ask shall select schedule mode before explicit-addition mode.
- [x] **CHAT-BE-034**: When schedule mode has one valid bounded authoritative saved-place match and valid schedule values, embedded Ask shall return one scheduled item, no suggestions or unresolved names, and perform no trip write.
- [x] **CHAT-BE-035**: If a schedule request lacks a required detail, resolves outside the inclusive trip range, or has zero or multiple saved-place matches, embedded Ask shall return no scheduled item and request clarification.
- [x] **CHAT-BE-036**: In schedule mode, embedded Ask shall disable web search and shall not claim availability, reservations, or conflict-free timing.
- [x] **CHAT-BE-037**: When a version-5 message explicitly asks to schedule one named idea with a valid date and time, embedded Ask shall return one reviewable schedule candidate for one exact authoritative saved match or, when no saved match exists, one exact validated new suggestion without writing trip state.
- [x] **CHAT-BE-038**: When a version-5 schedule request omits duration, embedded Ask shall assign 120 minutes; when it supplies a valid duration, embedded Ask shall preserve that duration.
- [x] **CHAT-BE-039**: When a traveler confirms a version-5 suggested schedule candidate, the trip API shall atomically normalize and add or reuse the place and add one confirmed itinerary item in one version increment under the existing mutation-ID and conflict semantics.
- [x] **CHAT-BE-040**: When a traveler confirms a version-5 saved schedule candidate, the trip API shall add one confirmed itinerary item without adding or modifying a saved place.

## Embedded Ask Interface

- [x] **CHAT-UI-001**: The trip workspace shall provide Ask as the fourth mobile-bottom and wide-screen-side navigation destination.
- [x] **CHAT-UI-002**: When a traveler submits Ask with Enter or the send control, the interface shall append the user message, show a loading state, and render the returned assistant message plus inline saved matches, new-place suggestions, and unresolved place names.
- [x] **CHAT-UI-003**: When Shift+Enter is pressed in the Ask composer, the interface shall insert a newline without submitting.
- [x] **CHAT-UI-004**: When a traveler dismisses an Ask suggestion, the interface shall remove only that session-local card without mutating the trip.
- [x] **CHAT-UI-005**: When a traveler adds an Ask suggestion, the interface shall expose saved, duplicate, retryable-conflict, or error status and retain the card when retry is possible.
- [x] **CHAT-UI-006**: While the workspace is offline, the Ask composer and individual or bulk suggestion-add controls shall be disabled while prior session messages, cards, and unresolved names remain readable.
- [x] **CHAT-UI-007**: When an Ask response contains a new trip-idea suggestion, the interface shall display a clickable “Learn more” action only when a validated HTTPS source exists and shall always display generated Apple Maps, Google Maps, and directions actions before the traveler adds it to the trip.
- [x] **CHAT-UI-008**: When an Ask response contains a valid saved-place ID, the interface shall render the current authoritative saved place's name, existing summary, useful tags, optional reference link, Apple Maps link, Google Maps link, and directions link in model-ranked order on mobile and desktop layouts.
- [x] **CHAT-UI-009**: When a traveler activates “View in Ideas” from an Ask saved-match card, the interface shall navigate to that authoritative saved place in Ideas without adding, removing, editing, favoriting, or scheduling any place.
- [x] **CHAT-UI-010**: When successful explicit link enrichment reports a newer trip version, the interface shall revalidate the authoritative trip and render the added saved-idea source as a clickable “Visit source” action.
- [x] **CHAT-UI-011**: When Ask renders assistant narrative, the interface shall preserve paragraphs, render simple numbered or bulleted lines as lists, convert only HTTPS Markdown links into safe outbound links, and render all other content as escaped text without interpreting raw HTML or unsafe URL schemes.
- [x] **CHAT-UI-012**: When an Ask response contains more than one unsaved new-place suggestion, the interface shall offer an “Add all new” action while preserving each card's individual add and dismiss actions.
- [x] **CHAT-UI-013**: While a bulk add is pending, the interface shall disable affected add controls, and after completion it shall show saved or duplicate status per submitted card while retaining retryable cards after a failure or repeated conflict.
- [x] **CHAT-UI-014**: When an Ask response contains unresolved place names, the interface shall identify them as needing clarification and shall provide no mutation control for them.
- [x] **CHAT-UI-015**: When Ask history exists, the interface shall provide a New chat control that is disabled during hydration or generation; after confirmation it shall clear rendered messages, composer text, errors, and suggestion statuses and return to the empty-state prompt, while canceling preserves the conversation.
- [x] **CHAT-UI-016**: The Ask composer shall provide a labeled Create cards checkbox that defaults off, is disabled with generation controls, submits `createCards: true` only for the next accepted message, resets immediately after that submission, and is excluded from saved chat history.
- [x] **CHAT-UI-017**: Each new Ask suggestion card shall identify itself as an unverified trip idea without describing the card as place-only.
- [x] **CHAT-UI-018**: When an assistant response contains a valid scheduled item, Ask shall display the saved idea, resolved date, local start time, duration, and an explicit confirmation control.
- [x] **CHAT-UI-019**: When a traveler confirms a scheduled item while online, the browser shall issue the existing versioned add-itinerary-item mutation with that candidate’s values, empty notes, and confirmed status and shall retain retryable conflict or error state without duplicating the item.
- [x] **CHAT-UI-020**: When a version-5 assistant response contains a valid saved or suggested schedule candidate, Ask shall display its place name, resolved date, local start time, duration, and one explicit confirmation control.
- [x] **CHAT-UI-021**: When a traveler confirms a version-5 schedule candidate while online, the browser shall issue one versioned confirm-chat-schedule mutation and shall retain retryable conflict or error state without duplicating the itinerary item.
- [x] **CHAT-UI-022**: When a version-5 schedule confirmation succeeds, the browser shall update shared trip state and the offline trip snapshot while remaining in Ask with success feedback.
- [x] **CHAT-UI-023**: When the traveler opens Plan after a successful version-5 schedule confirmation, the interface shall display the confirmed itinerary item on its scheduled date.

## Optimization Proposals

- [ ] **OPT-DATA-001**: Each pending plan proposal shall identify its base trip version, creation time, summary, status, and no more than ten explicit changes.
- [ ] **OPT-DATA-002**: Each proposed change shall contain one deterministic rationale.
- [ ] **OPT-BE-001**: When the optimizer evaluates a trip, it shall treat confirmed itinerary items as fixed constraints.
- [ ] **OPT-BE-002**: When the optimizer creates a proposal, it shall limit changes to adding unscheduled places or moving and reordering tentative items.
- [ ] **OPT-BE-003**: When saved-place coordinates are available, the optimizer shall use a stable nearest-next ordering for tentative items with equal scheduling eligibility.
- [ ] **OPT-BE-004**: If a place lacks coordinates or condition data, then the optimizer shall use neutral values rather than exclude that place.
- [ ] **OPT-BE-005**: The optimizer shall not infer opening hours, travel times, reservation availability, or booking availability.
- [ ] **OPT-BE-006**: When the optimizer creates a pending proposal, the system shall mark every older pending proposal as superseded.
- [ ] **OPT-BE-007**: If optimization produces no useful changes, then the system shall store no new pending proposal and return an explanatory message.
- [ ] **OPT-BE-008**: When a current proposal is applied, the system shall atomically apply all of its changes as one versioned trip mutation.
- [ ] **OPT-BE-009**: If a proposal's base version differs from the current trip version, then the system shall reject application with status 409.
- [ ] **OPT-BE-010**: When two optimizer inputs are equal, the optimizer shall produce the same ordered proposal changes.
- [ ] **OPT-BE-011**: When a pending proposal is dismissed, the system shall mark it dismissed without changing the itinerary.
- [ ] **OPT-BE-012**: When a pending proposal is applied, the system shall mark it applied.
- [ ] **OPT-BE-013**: When an applied proposal adds a place to the itinerary, the system shall mark the new itinerary item as tentative.
- [ ] **OPT-UI-001**: While a pending proposal exists, the Plan view shall display its summary and every proposed change before application.
- [ ] **OPT-UI-002**: While a pending proposal exists, the Plan view shall provide Apply and Dismiss controls.
- [ ] **OPT-UI-003**: When a proposal becomes stale after another trip edit, the Plan view shall require regeneration rather than applying it.

## Conditions

- [ ] **COND-API-001**: When the destination-neutral conditions API receives valid destination coordinates without a target time, it shall return conditions for the current hour at those coordinates.
- [ ] **COND-API-002**: When the destination-neutral conditions API receives valid coordinates without a time zone, it shall use the provider-resolved local time zone.
- [ ] **COND-API-003**: When the destination-neutral conditions API receives valid coordinates, it shall return normalized weather and US AQI data for those coordinates.
- [ ] **COND-API-004**: When the destination-neutral conditions request enables marine data, it shall return normalized marine data for the requested coordinates when available.
- [ ] **COND-API-005**: When no saved place is coastal or water-contact, the client shall request destination conditions without marine data.
- [ ] **COND-API-006**: If destination coordinates are unavailable, then the conditions adapter shall return unavailable status without contacting a provider.
- [ ] **COND-API-007**: Each destination-neutral conditions response shall identify its requested time, fetch time, expiry time, coordinates, time zone, availability, and source.
- [ ] **COND-API-008**: Each destination-neutral conditions response shall express temperatures in Fahrenheit, wind in miles per hour, air quality on the US AQI scale, and wave height in feet.
- [x] **COND-API-009**: The public conditions API shall allow shared caching for 15 minutes and stale-while-revalidate use for one hour.
- [x] **COND-API-010**: If any requested Open-Meteo condition group fails or times out after five seconds, then the conditions API shall return available groups with degraded status.
- [x] **COND-API-011**: If every requested Open-Meteo condition group fails or times out after five seconds, then the conditions API shall return status 200 with unavailable condition data.
- [x] **COND-API-012**: If the requested conditions target is outside the available forecast range, then the conditions API shall return status 200 with an unavailable `forecast-out-of-range` result.
- [ ] **COND-API-013**: If destination coordinates or the conditions target are malformed, then the conditions API shall return status 400 without contacting Open-Meteo.
- [x] **COND-API-014**: If one hashed client address requests conditions more than 120 times within one minute, then the conditions API shall reject subsequent requests with status 429 until that window expires.
- [ ] **COND-UI-001**: While destination conditions are available, the Today view shall display local time, freshness, temperature, precipitation probability, wind, AQI, and UV values that are present.
- [ ] **COND-UI-002**: While destination condition data is degraded, stale, or unavailable, the Today view shall label that state without hiding saved places or itinerary data.
- [x] **COND-UI-003**: While marine data is displayed, the Today view shall state that coastal-model data is advisory and unsuitable for navigation.
- [x] **COND-UI-004**: While a selected date is outside the forecast range, the Today view shall invite the user to refresh closer to that date.
- [ ] **COND-UI-005**: While destination marine conditions are available, the Today view shall display sea-surface temperature, wave height, and wave period.
- [x] **COND-UI-006**: The Today view shall provide controls for selecting the recommendation date and time.

## Recommendations and Optional Location

- [ ] **REC-BE-001**: When recommendations are requested for a schema-version-two trip, the system shall score every saved place on a 0–100 scale using preference, condition, time, and distance components.
- [x] **REC-BE-002**: The recommendation preference component shall score no interests as 24 or matching interests as `min(35, 12 + 12 × matches)`, subtract 8 above the maximum cost, subtract 5 above the 180/300/480-minute relaxed/balanced/full pace target, and clamp to 0–35.
- [x] **REC-BE-003**: The recommendation condition component shall use the approved indoor, outdoor, coastal, and mixed profile calculations and clamp the result to 0–30.
- [x] **REC-BE-004**: The recommendation time component shall score a preferred daypart as 20, an adjacent daypart as 12, another daypart as 6, and an outdoor or coastal place after daylight as 2.
- [x] **REC-BE-005**: The recommendation distance component shall use Haversine miles and score inclusive 2/5/10/20-mile bands as 15/12/8/4, farther places as 1, and a missing origin as 8.
- [x] **REC-BE-006**: If condition data is unavailable, then the recommendation engine shall use a neutral condition score of 18.
- [x] **REC-BE-007**: While condition data is partially available, the recommendation engine shall use neutral values for missing fields and score available fields.
- [ ] **REC-BE-008**: When saved-place recommendation scores are equal, the recommendation engine shall sort by normalized place name and then place identifier.
- [ ] **REC-BE-009**: When at least six saved-place recommendations exist, the Today view shall show the six highest-ranked places.
- [x] **REC-BE-010**: Each displayed recommendation shall include no more than three plain-language reasons derived from its strongest positive score contributions.
- [x] **REC-BE-011**: Each displayed recommendation shall include every material caution produced by its scoring penalties.
- [x] **REC-BE-012**: The recommendation engine shall treat marine values as advisory suitability inputs rather than safety determinations.
- [x] **REC-BE-013**: The outdoor condition score shall subtract 0/4/10/18 points for precipitation of 0–10%, above 10–30%, above 30–60%, and above 60%.
- [x] **REC-BE-014**: The outdoor condition score shall subtract 2 points per started 5°F outside 60–82°F up to 10 points.
- [x] **REC-BE-015**: The outdoor condition score shall subtract 0/4/10 points for wind of 0–15, above 15–25, and above 25 miles per hour.
- [x] **REC-BE-016**: The outdoor condition score shall subtract 0/2/7/14 points for US AQI of 0–50, above 50–100, above 100–150, and above 150.
- [x] **REC-BE-017**: The water-contact coastal condition score shall subtract 0/5/10 points for wave height of 0–4, above 4–6, and above 6 feet.
- [x] **REC-BE-018**: The indoor condition score shall start at 24, add 2 points for each available adverse precipitation, temperature, wind, or AQI signal, and clamp to 30.
- [x] **REC-BE-019**: The mixed-place condition score shall equal the rounded arithmetic mean of its indoor and outdoor condition scores.
- [x] **REC-BE-020**: The recommendation daypart shall use sunset-relative golden-hour and evening boundaries when sunset is available and the approved fixed boundaries when it is unavailable.
- [x] **REC-BE-021**: The recommendation daypart adjacency shall use the non-circular morning, midday, afternoon, golden-hour, and evening order.
- [x] **REC-BE-022**: When a score applies a nonzero penalty, the recommendation shall emit the corresponding stable caution code.
- [x] **REC-UI-001**: When a user explicitly requests location-based ranking, the system shall ask the browser for the device's current location.
- [x] **REC-UI-002**: While device coordinates are available for recommendation ranking, the browser shall retain them only in memory and calculate distance locally.
- [ ] **REC-UI-003**: If device location is denied, unavailable, or times out, then the system shall rank by the trip's home-base coordinates or the approved neutral distance when no home base exists.
- [x] **REC-UI-004**: If a device-location request fails, then the system shall not prompt again without another explicit user gesture.
- [x] **REC-UI-005**: While condition data is unavailable, the recommendation interface shall avoid claiming that ranking reflects live conditions.

## Ideas, Favorites, and Planning

- [ ] **EXP-UI-001**: The Ideas view shall search saved-place names, localities, summaries, and tags.
- [ ] **EXP-UI-002**: The Ideas view shall filter saved places by interest, cost, duration, profile, accessibility, reservation recommendation, and favorite status.
- [ ] **EXP-NAV-001**: When Ideas filters change, the system shall encode the filter state in URL search parameters.
- [ ] **EXP-NAV-002**: When browser navigation changes Ideas search parameters, the system shall restore the represented filter state.
- [ ] **EXP-UI-003**: When a user favorites or unfavorites a saved place while online, the system shall optimistically update the visible favorite state.
- [x] **EXP-UI-004**: If a favorite mutation fails, then the system shall restore authoritative favorite state and display a retryable error when applicable.
- [ ] **EXP-UI-005**: Each Ideas card shall provide actions to favorite, add to the itinerary, visit its optional source, and open directions.
- [x] **EXP-BE-006**: When a shared trip removes a saved idea, the system shall atomically remove that idea, its favorite reference, and every itinerary item that references it.
- [x] **EXP-UI-006**: Each Ideas card shall identify its shortlist toggle as Favorite or Favorited, offer a Remove idea action, and require confirmation that names any planned stops to be removed.
- [ ] **PLAN-UI-001**: The Plan view shall display one section for each date in the inclusive trip range.
- [ ] **PLAN-UI-002**: While the trip range includes the current destination-local date, the Plan view shall visually identify that date.
- [ ] **PLAN-UI-003**: While an itinerary day has no items, the Plan view shall display guidance for adding a saved place.
- [ ] **PLAN-UI-004**: When a user adds a saved place to an itinerary day, the system shall create an itinerary item referencing that embedded place.
- [ ] **PLAN-UI-005**: When a user confirms a tentative itinerary item, the system shall mark that item as confirmed.
- [x] **PLAN-UI-006**: When a user edits or removes an itinerary item while online, the system shall optimistically update the visible itinerary.
- [x] **PLAN-UI-007**: If an itinerary mutation fails, then the system shall restore authoritative itinerary state and preserve the user's unsaved form draft.
- [x] **PLAN-UI-008**: The Plan view shall provide keyboard- and touch-operable move controls for reordering items within one day.
- [x] **PLAN-UI-009**: The Plan view shall order timed items by start time and untimed items by their explicit day order.
- [x] **PLAN-BE-001**: When an itinerary day is reordered, the system shall require every and only the current item identifiers for that day.
- [x] **PLAN-BE-002**: If a trip date-range update would exclude existing itinerary items, then the system shall reject the update and identify the affected dates.
- [x] **PLAN-BE-003**: If an itinerary mutation targets an item that does not exist, then the system shall reject the mutation without changing the trip.
- [ ] **PLAN-UI-010**: When a user manually adds a saved place to an itinerary day, the system shall mark the new itinerary item as confirmed.

## Application Shell and Accessibility

- [x] **APP-UI-001**: The phone trip workspace shall provide persistent Today, Ideas, Plan, and Ask navigation at the bottom of the viewport.
- [x] **APP-UI-002**: The wide-screen trip workspace shall provide Today, Ideas, Plan, and Ask navigation in a left-side rail.
- [x] **APP-UI-003**: The trip companion shall remain usable without horizontal page scrolling at viewport widths of 375, 768, 1024, and 1440 CSS pixels.
- [x] **APP-UI-004**: The trip companion shall provide touch targets of at least 44 by 44 CSS pixels for primary interactive controls.
- [x] **APP-UI-005**: The trip companion shall provide visible keyboard focus, semantic labels, and WCAG AA color contrast for interactive content.
- [x] **APP-UI-006**: While reduced motion is requested by the operating system, the trip companion shall suppress nonessential interface motion.
- [x] **APP-UI-007**: The trip companion shall use a warm sand, deep navy, seafoam, and coral visual system.
- [x] **APP-UI-008**: When a destructive or validation dialog opens, the system shall move focus into it and return focus to the invoking control when it closes.
- [x] **APP-UI-009**: Each external link opened by the trip companion shall be protected from opener access and referrer disclosure.
- [x] **APP-UI-010**: Fixed trip-companion interface copy shall use direct, warm, mostly-English Spanglish while preserving unambiguous English labels for primary actions, privacy warnings, errors, and form controls.
- [x] **APP-UI-011**: The static-copy voice change shall not alter user-entered text, place names, source text, API data, navigation URLs, or model-generated Ask responses.
- [x] **REC-UI-006**: The Today view shall present a direct selected-day heading, plain condition availability guidance, recommendation context, and counts of saved ideas and planned stops without aspirational travel-marketing copy.
- [x] **PLAN-UI-011**: The Plan view shall introduce the itinerary as a day-by-day plan, label pending optimizer output as suggested changes, and provide concise guidance for each empty itinerary day to select an existing idea.

## PWA and Offline Behavior

- [x] **PWA-PROC-001**: The deployed trip companion shall expose a valid installable web-app manifest and operate over HTTPS.
- [ ] **PWA-PROC-002**: The trip companion service worker shall cache immutable application assets without requiring place images.
- [x] **PWA-PROC-003**: The trip companion service worker shall use a network-first policy with cached fallback for navigations and public condition responses.
- [ ] **PWA-PROC-004**: The trip companion service worker shall never cache authenticated browser trip API or Custom GPT Action API responses.
- [ ] **PWA-DATA-001**: When a schema-version-two trip is fetched successfully, the browser shall validate and save an offline snapshot indexed by a hash-derived key that excludes the raw token.
- [ ] **PWA-DATA-002**: If a persisted trip snapshot fails schema-version-two validation, then the browser shall delete it without rendering it.
- [ ] **PWA-UI-001**: While the device is offline, the trip companion shall display the cached application shell and latest valid trip and condition snapshots when available.
- [x] **PWA-UI-002**: While the device is offline, the trip companion shall label cached condition and trip data as stale.
- [ ] **PWA-UI-003**: While the device is offline, the trip companion shall disable shared-trip mutations and label external links as requiring connectivity.
- [x] **PWA-UI-004**: If browser persistence is unavailable or exceeds its quota, then the trip companion shall continue operating online without blocking the user.
- [x] **PWA-UI-005**: When connectivity returns, the trip companion shall revalidate shared-trip and condition data.
- [x] **PWA-UI-006**: When an application update is available while an edit form is dirty, the system shall defer activation until a later navigation.
- [x] **PWA-PROC-005**: While a shared-trip workspace is visible and online, the browser shall revalidate trip data every 15 seconds and on window focus.
- [x] **PWA-PROC-006**: While a shared-trip workspace is visible and online, the browser shall revalidate condition data every 15 minutes.
- [x] **PWA-PROC-007**: When the trip companion runs outside production, the browser shall unregister service workers left on the local origin, reload once when the page was controlled, and shall not register or populate a development application cache.
- [x] **PWA-UI-007**: While the device is offline, the trip companion shall disable embedded Ask generation and confirmation without deleting session-local messages.

## Security and Privacy

- [x] **SEC-NAV-001**: During browser navigation, the share token shall appear only in the `/trip` URL fragment.
- [x] **SEC-DATA-001**: The trip companion shall not persist the raw share token in cookies, browser storage, service-worker caches, or application logs.
- [x] **SEC-DATA-002**: The trip companion shall not transmit or persist browser geolocation coordinates.
- [ ] **SEC-DATA-003**: The trip companion shall render all user- and GPT-supplied text as text rather than executable markup.
- [x] **SEC-DATA-004**: The trip companion shall store only cryptographic hashes of client addresses used for rate limiting.
- [ ] **SEC-DATA-005**: The trip companion shall not write the Action key or Action trip token to application logs, analytics, browser persistence, or service-worker caches.
- [ ] **SEC-DATA-006**: The production trip companion shall reject a configured Action key shorter than 32 bytes.
- [x] **SEC-DATA-007**: The trip companion shall remove the exact share token from embedded Ask content before persisting session-local messages.
- [x] **SEC-DATA-008**: Embedded Ask telemetry shall exclude conversation content, raw client addresses, raw share tokens, model output, and server secrets.
- [x] **SEC-API-001**: The deployed trip companion shall send a content security policy that permits browser connections only to the application origin.
- [x] **SEC-API-002**: The deployed trip companion shall send headers that deny framing, prevent MIME sniffing, suppress referrers, and restrict unnecessary browser permissions.
- [ ] **SEC-API-003**: Both browser mutation routes and Action mutation routes shall reject request bodies larger than 64 KiB before parsing application data.
- [ ] **SEC-API-005**: The Action API shall accept Action and trip credentials only in their approved request headers.
- [ ] **SEC-API-006**: The trip companion shall not fetch a GPT-supplied place source URL from the server.
- [x] **SEC-API-007**: The embedded Ask model integration shall configure at most one bounded web-search tool call for standard requests or four for explicit-addition requests and shall not configure arbitrary outbound URL fetching or mutation tools.
- [x] **SEC-UI-001**: The trip companion shall include no analytics or third-party browser scripts in the initial release.

## Repository Workflow and Deployment

- [x] **OPS-PROC-001**: The repository shall require a Pixi version in the supported `>=0.69,<1` range.
- [x] **OPS-PROC-002**: The repository shall provide Pixi tasks for web dependency installation, development, formatting, linting, type checking, Python tests, web tests, browser tests, production build, and preview deployment.
- [x] **OPS-PROC-003**: The repository shall lock JavaScript dependencies for reproducible local and Vercel installations.
- [x] **OPS-PROC-004**: The Vercel build shall use the repository root, the configured Node.js runtime, locked JavaScript dependencies, and standard framework output.
- [ ] **OPS-PROC-005**: If required storage or Custom GPT Action variables are absent from production, then the affected trip APIs shall fail closed without exposing credentials or configuration values.
- [x] **OPS-PROC-006**: When the preview-deployment task is run, the system shall create a Vercel preview rather than a production deployment.
- [x] **OPS-PROC-007**: The repository workflow shall require explicit approval before initiating a production deployment.
- [x] **OPS-PROC-008**: Before a preview is accepted, the repository workflow shall require successful formatting, linting, type checking, unit tests, integration tests, browser tests, accessibility checks, and a production build.
- [x] **OPS-PROC-009**: If `OPENAI_API_KEY` or `OPENAI_MODEL` is absent, then the embedded Ask API shall fail closed while non-chat trip features remain available.
- [x] **OPS-PROC-010**: The production application shall require shared Upstash-backed trip and rate-limit storage, while Custom GPT Action credentials shall be optional unless that secondary client is enabled.
