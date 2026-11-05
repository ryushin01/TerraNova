"use client";

import { Alert, Badge, Button, Flex, NativeSelect, Spinner, Stack, Table, Text } from "@chakra-ui/react";
import { BUILTIN_CROP_NAMES, HISTORY_ACTIONS, ZONE_IDS, type HistoryEntry, type HistoryPage } from "@terranova/shared";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

const PAGE_SIZE = 50;

const RESULT_COLORS: Record<string, string> = {
  ok: "green",
  sent: "green",
  skipped: "gray",
  already_handled: "gray",
};

const zoneLetter = (zoneId: string) => zoneId.replace("zone-", "").toUpperCase();

type LoadState = "loading" | "ready" | "forbidden" | "failed";

function Filter({
  label,
  name,
  value,
  onChange,
  options,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <NativeSelect.Root size="md" w={{ base: "full", sm: "48" }}>
      <NativeSelect.Field
        name={name}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect.Field>
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  );
}

export function HistoryList() {
  const t = useTranslations("history");
  const tCrops = useTranslations("crops");
  const tZones = useTranslations("dashboard");
  const format = useFormatter();
  const [zone, setZone] = useState("");
  const [action, setAction] = useState("");
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [timeZone, setTimeZone] = useState<string>();
  const [state, setState] = useState<LoadState>("loading");
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(
    async (before?: number): Promise<HistoryPage | LoadState> => {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (zone) query.set("zone", zone);
      if (action) query.set("action", action);
      if (before) query.set("before", String(before));
      try {
        const response = await fetch(`/api/history?${query}`);
        if (response.status === 401 || response.status === 403) return "forbidden";
        return response.ok ? ((await response.json()) as HistoryPage) : "failed";
      } catch {
        return "failed";
      }
    },
    [zone, action],
  );

  const reload = useCallback(async () => {
    setState("loading");
    const page = await fetchPage();
    if (typeof page === "string") {
      setState(page);
      return;
    }
    setEntries(page.entries);
    setNextBefore(page.nextBefore);
    setTimeZone(page.timeZone);
    setState("ready");
  }, [fetchPage]);

  useEffect(() => {
    reload();
  }, [reload]);

  const loadMore = async () => {
    if (!nextBefore) return;
    setLoadingMore(true);
    const page = await fetchPage(nextBefore);
    setLoadingMore(false);
    if (typeof page === "string") {
      setState(page);
      return;
    }
    setEntries((current) => [...current, ...page.entries]);
    setNextBefore(page.nextBefore);
  };

  if (state === "forbidden") {
    return (
      <Alert.Root status="error">
        <Alert.Indicator />
        <Alert.Title>{t("forbidden")}</Alert.Title>
      </Alert.Root>
    );
  }

  const cropName = (crop?: { id: string; name: string }) => {
    if (!crop) return "";
    return crop.name === BUILTIN_CROP_NAMES[crop.id] && tCrops.has(crop.id as never)
      ? tCrops(crop.id as never)
      : crop.name;
  };

  const describe = ({ action: kind, detail }: HistoryEntry) => {
    switch (kind) {
      case "actuator_set":
        return t(`actions.${detail.actuator}${detail.on ? "On" : "Off"}` as never);
      case "zones_move":
        return t("actions.zones_move", { section: cropName(detail.crop) });
      case "crop_add":
      case "crop_remove":
        return t(`actions.${kind}`, { name: cropName(detail.crop) });
      case "crop_edit":
        return t("actions.crop_edit", { previous: detail.previousName ?? cropName(detail.crop), name: cropName(detail.crop) });
      case "password_reset":
        return t("actions.password_reset", { name: detail.target ?? "–" });
      case "alarm_times":
        return t("actions.alarm_times", {
          section: cropName(detail.crop),
          times: detail.times?.length ? detail.times.join(", ") : t("actions.noTimes"),
        });
      default:
        return t(`actions.${kind}`);
    }
  };

  const reasonText = (reason: string | null) =>
    reason && tZones.has(`reason.${reason}` as never) ? tZones(`reason.${reason}` as never) : null;

  return (
    <Stack gap="4">
      <Flex gap="3" wrap="wrap" align="center">
        <Filter
          label={t("filterZone")}
          name="history-zone"
          value={zone}
          onChange={setZone}
          options={[
            { value: "", label: t("allZones") },
            ...ZONE_IDS.map((id) => ({ value: id, label: tZones("zone", { id: zoneLetter(id) }) })),
          ]}
        />
        <Filter
          label={t("filterAction")}
          name="history-action"
          value={action}
          onChange={setAction}
          options={[
            { value: "", label: t("allActions") },
            ...HISTORY_ACTIONS.map((value) => ({ value, label: t(`filters.${value}`) })),
          ]}
        />
        <Button variant="outline" ms={{ sm: "auto" }} data-history-refresh onClick={reload}>
          {t("refresh")}
        </Button>
      </Flex>

      {state === "failed" && (
        <Alert.Root status="error">
          <Alert.Indicator />
          <Alert.Title>{t("failed")}</Alert.Title>
        </Alert.Root>
      )}
      {state === "loading" && entries.length === 0 && <Spinner aria-label={t("loading")} />}
      {state === "ready" && entries.length === 0 && (
        <Text color="fg.muted" data-history-empty>
          {t("empty")}
        </Text>
      )}

      {entries.length > 0 && (
        <Table.ScrollArea borderWidth="1px" borderRadius="md">
          <Table.Root size="sm">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>{t("time")}</Table.ColumnHeader>
                <Table.ColumnHeader>{t("actor")}</Table.ColumnHeader>
                <Table.ColumnHeader>{t("zone")}</Table.ColumnHeader>
                <Table.ColumnHeader>{t("action")}</Table.ColumnHeader>
                <Table.ColumnHeader>{t("result")}</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {entries.map((entry) => {
                const resultKey = `results.${entry.result}`;
                const reason = reasonText(entry.reason);
                return (
                  <Table.Row key={entry.id} data-history-row={entry.action} data-result={entry.result}>
                    <Table.Cell whiteSpace="nowrap" fontVariantNumeric="tabular-nums">
                      {format.dateTime(new Date(entry.at), { dateStyle: "short", timeStyle: "medium", timeZone })}
                    </Table.Cell>
                    <Table.Cell whiteSpace="nowrap">{entry.actorName}</Table.Cell>
                    <Table.Cell whiteSpace="nowrap">
                      {entry.zoneId ? zoneLetter(entry.zoneId) : "–"}
                    </Table.Cell>
                    <Table.Cell minW="40">{describe(entry)}</Table.Cell>
                    <Table.Cell minW="24">
                      <Badge colorPalette={RESULT_COLORS[entry.result] ?? "red"}>
                        {t.has(resultKey as never) ? t(resultKey as never) : entry.result}
                      </Badge>
                      {reason && (
                        <Text textStyle="xs" color="fg.muted" mt="1">
                          {reason}
                        </Text>
                      )}
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
        </Table.ScrollArea>
      )}

      {nextBefore !== null && (
        <Button variant="outline" alignSelf="center" data-history-more loading={loadingMore} onClick={loadMore}>
          {t("more")}
        </Button>
      )}
    </Stack>
  );
}
