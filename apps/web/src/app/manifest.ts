import type { MetadataRoute } from "next";

/** Lets the app be added to a home screen, which iPhones require for Web Push. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TerraNova",
    short_name: "TerraNova",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f2f2",
    theme_color: "#181818",
    icons: [{ src: "/crops/seedling.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
