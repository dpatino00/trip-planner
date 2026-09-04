import type { MetadataRoute } from "next";

// @spec PWA-PROC-001
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "San Diego Trip Companion",
    short_name: "Trip Companion",
    description: "Curated San Diego recommendations and a shared trip plan.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f1e5",
    theme_color: "#123047",
    icons: [
      {
        src: "/icons/trip-icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/trip-icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
