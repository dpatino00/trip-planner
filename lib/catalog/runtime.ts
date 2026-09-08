import { catalogAuthConfig } from "@/lib/catalog/auth";
import {
  createCatalogRepository,
  createMemoryCatalogRepository,
  type CatalogRepository,
} from "@/lib/catalog/repository";
import {
  createCatalogService,
  type CatalogService,
} from "@/lib/catalog/service";
import { createTripRepository } from "@/lib/trips/repository";
import {
  getDevelopmentTripRepository,
  type TripRepository,
} from "@/lib/trips/repository-memory";

const developmentState = globalThis as typeof globalThis & {
  tripCatalogRepository?: CatalogRepository;
  tripCatalogService?: CatalogService;
};

function productionTripRepository(): TripRepository {
  return createTripRepository();
}

// @spec CAT-BE-001, CAT-SEC-001
export function getCatalogService() {
  const config = catalogAuthConfig();
  if (!config) throw new Error("Trip catalog is not configured");
  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_E2E !== "1"
  ) {
    return createCatalogService({
      catalogRepository: createCatalogRepository(),
      tripRepository: productionTripRepository(),
      encryptionKey: config.encryptionKey,
    });
  }
  return (developmentState.tripCatalogService ??= createCatalogService({
    catalogRepository: (developmentState.tripCatalogRepository ??=
      createMemoryCatalogRepository()),
    tripRepository: getDevelopmentTripRepository(),
    encryptionKey: config.encryptionKey,
  }));
}
