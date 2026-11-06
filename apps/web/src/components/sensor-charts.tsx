"use client";

import {
  Alert,
  Box,
  Button,
  Card,
  Flex,
  NativeSelect,
  SegmentGroup,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { SENSOR_RANGES, type SensorRange, type SensorSeries, ZONE_IDS } from "@terranova/shared";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chamfer } from "./theme";

const RANGES = Object.keys(SENSOR_RANGES) as SensorRange[];
const REFRESH_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const LINE_COLOR = "var(--chakra-colors-ink)";
const GRID_COLOR = "var(--chakra-colors-chart-grid)";
const AXIS_COLOR = "var(--chakra-colors-chart-axis)";

type Measure = "temperatureC" | "humidityPct" | "soilMoisturePct";

// Different units and ranges, so each gets its own chart rather than a second axis.
const MEASURES: { key: Measure; unit: string; domain?: [number, number] }[] = [
  { key: "temperatureC", unit: "°C" },
  { key: "humidityPct", unit: "%", domain: [0, 100] },
  { key: "soilMoisturePct", unit: "%", domain: [0, 100] },
];

interface Row {
  time: number;
  temperatureC: number | null;
  humidityPct: number | null;
  soilMoisturePct: number | null;
}

/** One row per bucket across the whole range, so missing readings show as gaps in the line. */
function toRows({ points, fromMs, toMs, bucketMs }: SensorSeries): Row[] {
  const byTime = new Map(points.map((point) => [Date.parse(point.at), point]));
  const rows: Row[] = [];
  for (let time = Math.floor(fromMs / bucketMs) * bucketMs; time <= toMs; time += bucketMs) {
    const point = byTime.get(time);
    rows.push({
      time,
      temperatureC: point?.temperatureC ?? null,
      humidityPct: point?.humidityPct ?? null,
      soilMoisturePct: point?.soilMoisturePct ?? null,
    });
  }
  return rows;
}

function SensorChart({
  measure,
  rows,
  series,
}: {
  measure: (typeof MEASURES)[number];
  rows: Row[];
  series: SensorSeries;
}) {
  const t = useTranslations("sensors");
  const format = useFormatter();
  const { key, unit, domain } = measure;
  const { timeZone } = series;
  const showDate = series.toMs - series.fromMs > DAY_MS;

  const number = (value: number) => format.number(value, { maximumFractionDigits: 1 });
  const fullTime = (time: number) =>
    format.dateTime(new Date(time), { dateStyle: "short", timeStyle: "short", timeZone });
  const shortTime = (time: number) =>
    format.dateTime(
      new Date(time),
      showDate ? { month: "numeric", day: "numeric", timeZone } : { timeStyle: "short", timeZone },
    );

  const present = rows.filter((row) => row[key] !== null);
  const latest = present.at(-1)?.[key] ?? null;
  const values = present.map((row) => row[key] as number);
  const label = t("chartLabel", {
    name: t(key),
    summary: values.length
      ? t("chartSummary", { min: number(Math.min(...values)), max: number(Math.max(...values)), unit })
      : t("empty"),
  });

  return (
    <Card.Root
      data-sensor-chart={key}
      variant="elevated"
      boxShadow="none"
      border="none"
      borderRadius="0"
      style={{ clipPath: chamfer() }}
    >
      <Card.Body gap="2" p="4">
        <Flex justify="space-between" align="baseline" gap="2">
          <Card.Title fontWeight="800">{t(key)}</Card.Title>
          <Text
            fontSize="2xl"
            fontWeight="800"
            letterSpacing="-0.02em"
            fontVariantNumeric="tabular-nums"
            data-sensor-latest
          >
            {latest === null ? "–" : `${number(latest)}${unit}`}
          </Text>
        </Flex>
        <Box h="44" role="img" aria-label={label}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID_COLOR} />
              <XAxis
                dataKey="time"
                type="number"
                scale="time"
                domain={[series.fromMs, series.toMs]}
                tickFormatter={shortTime}
                tickCount={5}
                minTickGap={48}
                stroke={AXIS_COLOR}
                tickLine={false}
                fontSize={12}
              />
              <YAxis
                domain={domain ?? [(min: number) => Math.floor(min - 1), (max: number) => Math.ceil(max + 1)]}
                allowDecimals={false}
                width={36}
                stroke={AXIS_COLOR}
                axisLine={false}
                tickLine={false}
                fontSize={12}
              />
              <Tooltip
                cursor={{ stroke: AXIS_COLOR, strokeWidth: 1 }}
                content={({ active, payload }) => {
                  const row = payload?.[0]?.payload as Row | undefined;
                  if (!active || !row || row[key] === null) return null;
                  return (
                    <Box
                      data-sensor-tooltip
                      bg="bg.panel"
                      borderWidth="1px"
                      borderRadius="md"
                      boxShadow="sm"
                      px="3"
                      py="2"
                      textStyle="sm"
                    >
                      <Text color="fg.muted" textStyle="xs">
                        {fullTime(row.time)}
                      </Text>
                      <Text
                        fontWeight="medium"
                        fontVariantNumeric="tabular-nums"
                      >{`${number(row[key] as number)}${unit}`}</Text>
                    </Box>
                  );
                }}
              />
              <Line
                dataKey={key}
                stroke={LINE_COLOR}
                strokeWidth={2}
                connectNulls={false}
                isAnimationActive={false}
                // A reading with gaps on both sides has no line to show it, so it gets a marker.
                dot={({ index, cx, cy, value }) => {
                  const alone = value !== null && rows[index - 1]?.[key] == null && rows[index + 1]?.[key] == null;
                  return alone ? <circle key={index} cx={cx} cy={cy} r={4} fill={LINE_COLOR} /> : <g key={index} />;
                }}
                activeDot={{ r: 4, fill: LINE_COLOR, stroke: "var(--chakra-colors-bg-panel)", strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </Card.Body>
    </Card.Root>
  );
}

export function SensorCharts() {
  const t = useTranslations("sensors");
  const tZones = useTranslations("dashboard");
  const format = useFormatter();
  const [zone, setZone] = useState<string>(ZONE_IDS[0]);
  const [range, setRange] = useState<SensorRange>("24h");
  const [series, setSeries] = useState<SensorSeries | null>(null);
  const [failed, setFailed] = useState(false);
  const [showTable, setShowTable] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/sensors?zone=${zone}&range=${range}`);
      if (!response.ok) throw new Error(String(response.status));
      setSeries((await response.json()) as SensorSeries);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [zone, range]);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const rows = useMemo(() => (series ? toRows(series) : []), [series]);
  const recorded = rows.filter((row) => row.temperatureC !== null).reverse();
  const number = (value: number | null) => (value === null ? "–" : format.number(value, { maximumFractionDigits: 1 }));

  return (
    <Stack gap="4">
      <Flex gap="3" wrap="wrap" align="center">
        <NativeSelect.Root size="md" w={{ base: "full", sm: "48" }}>
          <NativeSelect.Field
            name="sensor-zone"
            aria-label={t("zone")}
            value={zone}
            onChange={(event) => setZone(event.currentTarget.value)}
          >
            {ZONE_IDS.map((id) => (
              <option key={id} value={id}>
                {tZones("zone", { id: id.replace("zone-", "").toUpperCase() })}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
        <SegmentGroup.Root
          value={range}
          aria-label={t("range")}
          onValueChange={({ value }) => value && setRange(value as SensorRange)}
        >
          <SegmentGroup.Indicator />
          <SegmentGroup.Items items={RANGES.map((value) => ({ value, label: t(`ranges.${value}`) }))} />
        </SegmentGroup.Root>
      </Flex>

      {failed && (
        <Alert.Root status="error">
          <Alert.Indicator />
          <Alert.Title>{t("failed")}</Alert.Title>
        </Alert.Root>
      )}
      {!series && !failed && <Spinner aria-label={t("loading")} />}
      {series && recorded.length === 0 && (
        <Text color="fg.muted" data-sensor-empty>
          {t("empty")}
        </Text>
      )}

      {series && recorded.length > 0 && (
        <>
          {MEASURES.map((measure) => (
            <SensorChart key={measure.key} measure={measure} rows={rows} series={series} />
          ))}
          <Button
            variant="outline"
            alignSelf="flex-start"
            data-sensor-table-toggle
            onClick={() => setShowTable((shown) => !shown)}
          >
            {t(showTable ? "hideTable" : "showTable")}
          </Button>
          {showTable && (
            <Table.ScrollArea borderWidth="1px" borderRadius="md" maxH="96">
              <Table.Root size="sm" stickyHeader>
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>{t("time")}</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">{t("temperatureC")} (°C)</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">{t("humidityPct")} (%)</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">{t("soilMoisturePct")} (%)</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {recorded.map((row) => (
                    <Table.Row key={row.time} data-sensor-row>
                      <Table.Cell whiteSpace="nowrap">
                        {format.dateTime(new Date(row.time), {
                          dateStyle: "short",
                          timeStyle: "short",
                          timeZone: series.timeZone,
                        })}
                      </Table.Cell>
                      <Table.Cell textAlign="end">{number(row.temperatureC)}</Table.Cell>
                      <Table.Cell textAlign="end">{number(row.humidityPct)}</Table.Cell>
                      <Table.Cell textAlign="end">{number(row.soilMoisturePct)}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Table.ScrollArea>
          )}
        </>
      )}
    </Stack>
  );
}
