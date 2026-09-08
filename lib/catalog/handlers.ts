import {
  catalogAuthConfig,
  createCatalogSession,
  expiredSessionCookie,
  passwordIsValid,
  sessionCookie,
  sessionFromRequest,
  sessionIsValid,
} from "@/lib/catalog/auth";
import type { CatalogService } from "@/lib/catalog/service";

const noStore = { "cache-control": "no-store" };

function result(body: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(body, { status, headers: { ...noStore, ...headers } });
}

function unavailable() {
  return result(
    {
      error: {
        code: "catalog-unavailable",
        message: "Trip catalog is unavailable",
      },
    },
    503,
  );
}

function unauthorized() {
  return result(
    { error: { code: "unauthorized", message: "Catalog sign-in is required" } },
    401,
  );
}

async function body(request: Request) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 64 * 1024) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isAuthenticated(request: Request) {
  const config = catalogAuthConfig();
  return config && sessionIsValid(sessionFromRequest(request), config);
}

// @spec CAT-API-001, CAT-API-002, CAT-API-003, CAT-API-004, CAT-API-005, CAT-SEC-001, CAT-SEC-002
export function createCatalogHandlers(service: CatalogService) {
  return {
    async signIn(request: Request) {
      const config = catalogAuthConfig();
      if (!config) return unavailable();
      const parsed = await body(request);
      const password =
        parsed && typeof parsed === "object" && "password" in parsed
          ? (parsed as { password?: unknown }).password
          : null;
      if (typeof password !== "string" || !passwordIsValid(password, config))
        return unauthorized();
      return result({ ok: true }, 200, {
        "set-cookie": sessionCookie(createCatalogSession(config)),
      });
    },

    signOut() {
      return result({ ok: true }, 200, {
        "set-cookie": expiredSessionCookie(),
      });
    },

    async list(request: Request) {
      if (!catalogAuthConfig()) return unavailable();
      if (!isAuthenticated(request)) return unauthorized();
      try {
        return result({ trips: await service.list() });
      } catch {
        return unavailable();
      }
    },

    async create(request: Request) {
      if (!catalogAuthConfig()) return unavailable();
      if (!isAuthenticated(request)) return unauthorized();
      const parsed = await body(request);
      if (!parsed)
        return result(
          {
            error: {
              code: "invalid-trip",
              message: "Trip details are invalid",
            },
          },
          400,
        );
      try {
        const created = await service.create(parsed);
        return result(created, 201);
      } catch (cause) {
        return result(
          {
            error: {
              code: "invalid-trip",
              message:
                cause instanceof Error
                  ? cause.message
                  : "Could not create the trip",
            },
          },
          400,
        );
      }
    },

    async importTrip(request: Request) {
      if (!catalogAuthConfig()) return unavailable();
      if (!isAuthenticated(request)) return unauthorized();
      const parsed = await body(request);
      const link =
        parsed && typeof parsed === "object" && "link" in parsed
          ? (parsed as { link?: unknown }).link
          : null;
      if (typeof link !== "string")
        return result(
          {
            error: {
              code: "invalid-link",
              message: "Paste a complete private trip link or key",
            },
          },
          400,
        );
      try {
        return result({ trip: await service.import(link) }, 201);
      } catch (cause) {
        return result(
          {
            error: {
              code: "trip-not-found",
              message:
                cause instanceof Error
                  ? cause.message
                  : "Could not import trip",
            },
          },
          400,
        );
      }
    },

    async remove(request: Request, id: string) {
      if (!catalogAuthConfig()) return unavailable();
      if (!isAuthenticated(request)) return unauthorized();
      const parsed = await body(request);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        (parsed as { confirmation?: unknown }).confirmation !== "DELETE"
      )
        return result(
          {
            error: {
              code: "invalid-confirmation",
              message: "Type DELETE to confirm",
            },
          },
          400,
        );
      try {
        return (await service.delete(id))
          ? new Response(null, { status: 204, headers: noStore })
          : result(
              { error: { code: "trip-not-found", message: "Trip not found" } },
              404,
            );
      } catch {
        return unavailable();
      }
    },
  };
}
