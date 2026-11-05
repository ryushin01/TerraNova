"use client";

import { Alert, Button, Stack } from "@chakra-ui/react";
import type { WateringCycle } from "@terranova/shared";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { zoneLetter } from "./zone-card";

interface Props {
  alarms: WateringCycle[];
  pumping: string[];
  allowed: boolean;
  connected: boolean;
  pending: Set<string>;
  onConfirm: (cycleId: string) => void;
  onConfirmAll: () => void;
  onStop: (zoneId: string) => void;
}

/** What needs attention now. It stays on screen while scrolling, since a pump can be stopped from here. */
export function AlarmBanners({ alarms, pumping, allowed, connected, pending, onConfirm, onConfirmAll, onStop }: Props) {
  const t = useTranslations("dashboard");
  const [showAlarmList, setShowAlarmList] = useState(false);

  if (alarms.length === 0 && pumping.length === 0) return null;

  return (
    <Stack gap="2" position="sticky" top="2" zIndex="sticky" maxH="50vh" overflowY="auto">
      {alarms.length > 1 && (
        <Alert.Root status="warning" alignItems="center" flexWrap="wrap" gap="3">
          <Alert.Indicator />
          <Alert.Title flex="1" minW="40" data-alarm-summary>
            {t("alarm", { zone: alarms.map((alarm) => zoneLetter(alarm.zoneId)).join(", ") })}
          </Alert.Title>
          <Button size="lg" variant="ghost" onClick={() => setShowAlarmList((shown) => !shown)}>
            {t(showAlarmList ? "hideAlarms" : "showAlarms")}
          </Button>
          {allowed && (
            <Button size="lg" colorPalette="orange" data-confirm-all disabled={!connected} onClick={onConfirmAll}>
              {t("confirmAll")}
            </Button>
          )}
        </Alert.Root>
      )}
      {(alarms.length === 1 || showAlarmList) &&
        alarms.map((alarm) => (
          <Alert.Root key={alarm.id} status="warning" alignItems="center" flexWrap="wrap" gap="3">
            <Alert.Indicator />
            <Alert.Title flex="1" minW="40">
              {t("alarm", { zone: zoneLetter(alarm.zoneId) })}
              {alarm.reminderCount > 0 && ` · ${t("reminded", { count: alarm.reminderCount })}`}
            </Alert.Title>
            {allowed && (
              <Button
                size="lg"
                colorPalette="orange"
                disabled={!connected}
                loading={pending.has(alarm.id)}
                onClick={() => onConfirm(alarm.id)}
              >
                {t("confirm")}
              </Button>
            )}
          </Alert.Root>
        ))}
      {pumping.map((zoneId) => (
        <Alert.Root key={zoneId} status="info" alignItems="center" flexWrap="wrap" gap="3">
          <Alert.Indicator />
          <Alert.Title flex="1" minW="40">
            {t("pumping", { zone: zoneLetter(zoneId) })}
          </Alert.Title>
          {allowed && (
            <Button
              size="lg"
              colorPalette="red"
              data-stop={zoneId}
              disabled={!connected}
              loading={pending.has(`stop:${zoneId}`)}
              onClick={() => onStop(zoneId)}
            >
              {t("stop")}
            </Button>
          )}
        </Alert.Root>
      ))}
    </Stack>
  );
}
