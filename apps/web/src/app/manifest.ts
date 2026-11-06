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
    icons: [{ src: "/app-icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
