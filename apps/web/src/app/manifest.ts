import type { MetadataRoute } from "next";

/** Lets the app be added to a home screen, which iPhones require for Web Push. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TerraNova",
    short_name: "TerraNova",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f5f5",
    theme_color: "#181818",
    // PNG first: Android and older browsers do not install SVG-only icons.
    // The sprout sits inside the maskable safe zone on a full-bleed white background.
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/app-icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
