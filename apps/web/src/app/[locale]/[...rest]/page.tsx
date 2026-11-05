import { notFound } from "next/navigation";

/** Sends unknown paths to [locale]/not-found.tsx, so the 404 screen keeps the layout and language. */
export default function CatchAllPage() {
  notFound();
}
