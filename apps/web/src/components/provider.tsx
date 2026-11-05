"use client";

import { ChakraProvider } from "@chakra-ui/react";
import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import { useServerInsertedHTML } from "next/navigation";
import { useState, type ReactNode } from "react";
import { system } from "./theme";

/**
 * Sends Emotion's server styles through Next's streaming head insertion. Without this,
 * Emotion renders <style> tags inside the tree and React reports a hydration mismatch.
 */
function createEmotionRegistry() {
  const cache = createCache({ key: "css" });
  // Makes Emotion hand styles to cache.insert instead of rendering them inline on the server.
  cache.compat = true;

  let inserted: { name: string; isGlobal: boolean }[] = [];
  const insert = cache.insert;
  cache.insert = (selector, serialized, sheet, shouldCache) => {
    if (cache.inserted[serialized.name] === undefined) {
      inserted.push({ name: serialized.name, isGlobal: !selector });
    }
    return insert(selector, serialized, sheet, shouldCache);
  };

  const flush = () => {
    const flushed = inserted;
    inserted = [];
    return flushed;
  };
  return { cache, flush };
}

export function Provider({ children }: { children: ReactNode }) {
  const [{ cache, flush }] = useState(createEmotionRegistry);

  useServerInsertedHTML(() => {
    const globals: { name: string; css: string }[] = [];
    const names: string[] = [];
    let css = "";

    for (const { name, isGlobal } of flush()) {
      const style = cache.inserted[name];
      if (typeof style !== "string") continue;
      if (isGlobal) {
        globals.push({ name, css: style });
      } else {
        names.push(name);
        css += style;
      }
    }

    return (
      <>
        {globals.map((global) => (
          <style
            key={global.name}
            data-emotion={`${cache.key}-global ${global.name}`}
            dangerouslySetInnerHTML={{ __html: global.css }}
          />
        ))}
        {css && (
          <style
            data-emotion={`${cache.key} ${names.join(" ")}`}
            dangerouslySetInnerHTML={{ __html: css }}
          />
        )}
      </>
    );
  });

  return (
    <CacheProvider value={cache}>
      <ChakraProvider value={system}>{children}</ChakraProvider>
    </CacheProvider>
  );
}
