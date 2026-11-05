"use client";

import { useLocale } from "next-intl";
import { useCallback, useEffect, useState } from "react";

const urlKeyToBytes = (key: string) => {
  const base64 = key.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(key.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
};

const post = (path: string, body: unknown) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export type PushOutcome = "ok" | "denied" | "unavailable";

/** Alarm notifications for this browser. Needs a certificate the browser trusts, or localhost. */
export function usePush() {
  const locale = useLocale();
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !window.isSecureContext) return;
    setSupported(true);
    navigator.serviceWorker
      .getRegistration("/sw.js")
      .then((registration) => registration?.pushManager.getSubscription())
      .then((subscription) => setEnabled(!!subscription))
      .catch(() => setEnabled(false));
  }, []);

  const enable = useCallback(async (): Promise<PushOutcome> => {
    try {
      const keyResponse = await fetch("/api/push/key");
      if (!keyResponse.ok) return "unavailable";
      const { publicKey } = (await keyResponse.json()) as { publicKey: string };

      if ((await Notification.requestPermission()) !== "granted") return "denied";

      await navigator.serviceWorker.register("/sw.js");
      const ready = await navigator.serviceWorker.ready;
      const subscription = await ready.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlKeyToBytes(publicKey),
      });
      const saved = await post("/api/push/subscribe", { ...subscription.toJSON(), locale });
      if (!saved.ok) {
        await subscription.unsubscribe();
        return "unavailable";
      }
      setEnabled(true);
      return "ok";
    } catch {
      // Most often a certificate the browser doesn't trust, which service workers refuse.
      return "unavailable";
    }
  }, [locale]);

  const disable = useCallback(async () => {
    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await post("/api/push/unsubscribe", { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
    } finally {
      setEnabled(false);
    }
  }, []);

  return { supported, enabled, enable, disable };
}
