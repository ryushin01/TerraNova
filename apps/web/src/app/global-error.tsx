"use client";

import { useEffect } from "react";

/**
 * Shown when the [locale] layout itself fails. It replaces that layout, so it draws its own html
 * and body, and it uses plain styles because the Chakra and translation providers are gone too.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          padding: "96px 16px",
          fontFamily: "system-ui, sans-serif",
          color: "#18181b",
          background: "#ffffff",
        }}
      >
        <title>문제가 발생했어요</title>
        <main style={{ maxWidth: 384, margin: "0 auto" }}>
          <h1 style={{ margin: "0 0 12px", fontSize: 28 }}>문제가 발생했어요</h1>
          <p style={{ margin: "0 0 4px", color: "#52525b" }}>
            화면을 불러오지 못했어요. 다시 시도해 주세요.
          </p>
          <p lang="en" style={{ margin: "0 0 24px", color: "#52525b" }}>
            Something went wrong. Please try again.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              minHeight: 44,
              padding: "0 16px",
              border: 0,
              borderRadius: 6,
              color: "#ffffff",
              background: "#18181b",
              font: "inherit",
              cursor: "pointer",
            }}
          >
            다시 시도 / <span lang="en">Try again</span>
          </button>
        </main>
      </body>
    </html>
  );
}
