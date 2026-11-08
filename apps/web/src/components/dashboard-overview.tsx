"use client";

import { Box, Flex, Grid, Heading, HStack, Stack, Status, Text, Wrap } from "@chakra-ui/react";
import { SOIL_SUFFICIENT_PCT, type WateringCycle, ZONE_IDS, type ZoneSnapshot } from "@terranova/shared";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { IconType } from "react-icons";
import { LuActivity, LuBellRing, LuDroplets, LuSprout, LuWifi } from "react-icons/lu";
import { FIELD_ANIMATIONS, type FieldLook, LEGEND, SOIL_DRY_BELOW, zoneCondition } from "./field-plot";
import { Contours, Panel, PanelLabel } from "./panel";
import { zoneLetter } from "./zone-card";

type Connection = "connecting" | "connected" | "disconnected";

interface Props {
  connection: Connection;
  timeZone: string;
  cropCount: number;
  zones: Record<string, ZoneSnapshot | undefined>;
  cycles: Record<string, WateringCycle | undefined>;
  pumpingCount: number;
  alarmCount: number;
}

/** The time at the farm, which is what alarm times are written in. Set after loading, as the server can't know it. */
function useMinuteClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const GAUGE_ARC = "M 16 104 A 84 84 0 0 1 184 104";

/** Where a percentage falls on the gauge's half circle. */
const gaugePoint = (pct: number, radius: number) => {
  const angle = Math.PI * (1 - pct / 100);
  return { x: 100 + radius * Math.cos(angle), y: 104 - radius * Math.sin(angle) };
};

function SoilGauge({ value }: { value: number | undefined }) {
  const t = useTranslations("dashboard.overview");
  const marks = [SOIL_DRY_BELOW, SOIL_SUFFICIENT_PCT];
  return (
    <Box
      as="svg"
      w="full"
      maxW="80"
      mx="auto"
      display="block"
      hideBelow="md"
      aria-hidden
      {...{ viewBox: "0 0 200 112" }}
    >
      <path d={GAUGE_ARC} fill="none" stroke="var(--chakra-colors-night-line)" strokeWidth="14" />
      <path
        d={GAUGE_ARC}
        fill="none"
        stroke="currentColor"
        strokeWidth="14"
        pathLength={100}
        strokeDasharray={`${value ?? 0} 100`}
        style={{ transition: "stroke-dasharray 0.6s" }}
      />
      {marks.map((pct) => {
        const from = gaugePoint(pct, 74);
        const to = gaugePoint(pct, 94);
        const text = gaugePoint(pct, 60);
        return (
          <g key={pct}>
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="var(--chakra-colors-night-bg)" strokeWidth="2" />
            <text
              x={text.x}
              y={text.y}
              fill="var(--chakra-colors-night-muted)"
              fontSize="10"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {pct}
            </text>
          </g>
        );
      })}
      <text x="100" y="100" fill="var(--chakra-colors-night-muted)" fontSize="10" textAnchor="middle">
        {t("dryLine")} {SOIL_DRY_BELOW} · {t("enoughLine")} {SOIL_SUFFICIENT_PCT}
      </text>
    </Box>
  );
}

function Stat({
  icon: StatIcon,
  label,
  value,
  alert = false,
}: {
  icon: IconType;
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <Flex
      flex="1"
      align="center"
      justify="space-between"
      gap="3"
      py="2"
      borderBottomWidth="1px"
      borderColor="night.line"
    >
      <HStack gap="2" color="night.muted" minW="0">
        <StatIcon aria-hidden />
        <Text textStyle="sm" truncate>
          {label}
        </Text>
      </HStack>
      <Text
        data-summary={label}
        fontFamily="mono"
        fontSize="xl"
        lineHeight="1.2"
        flexShrink={0}
        px={alert ? "2" : undefined}
        bg={alert ? "field.alarm" : undefined}
        color={alert ? "ink" : undefined}
        borderRadius="sm"
      >
        {value}
      </Text>
    </Flex>
  );
}

function ZoneMap({ tiles, label }: { tiles: { id: string; look: FieldLook }[]; label: string }) {
  return (
    <Grid
      role="img"
      aria-label={label}
      data-zone-map
      flex="1"
      templateColumns="repeat(3, 1fr)"
      gridAutoRows="1fr"
      gap="1"
    >
      {tiles.map(({ id, look }) => {
        const animation = FIELD_ANIMATIONS[look];
        return (
          <Flex
            key={id}
            data-map-tile={id}
            data-map-look={look}
            minH={{ base: "12", sm: "16" }}
            align="center"
            justify="center"
            bg={`field.${look}`}
            color="ink"
            fontFamily="mono"
            fontWeight="bold"
            fontSize={{ base: "md", md: "lg" }}
            borderRadius="sm"
            transition="background-color 0.3s"
            animation={animation}
            _motionReduce={{ animation: "none" }}
          >
            {zoneLetter(id)}
          </Flex>
        );
      })}
    </Grid>
  );
}

/** The top row of the dashboard: the title, the field's overall moisture, and every zone's state at a glance. */
export function DashboardOverview({ connection, timeZone, cropCount, zones, cycles, pumpingCount, alarmCount }: Props) {
  const t = useTranslations("dashboard");
  const format = useFormatter();
  const now = useMinuteClock();

  const disconnected = connection === "disconnected";
  const conditions = ZONE_IDS.map((id) => ({ id, ...zoneCondition(zones[id], cycles[id], disconnected) }));

  const soilValues = ZONE_IDS.flatMap((id) => {
    const soil = zones[id]?.online ? zones[id]?.telemetry?.soilMoisturePct : undefined;
    return soil === undefined ? [] : [soil];
  });
  const averageSoil = soilValues.length
    ? soilValues.reduce((total, soil) => total + soil, 0) / soilValues.length
    : undefined;

  const mapLabel = t("overview.mapLabel", {
    zones: conditions
      .map(({ id, stateKey }) => t("overview.mapZone", { zone: zoneLetter(id), state: t(`state.${stateKey}`) }))
      .join(", "),
  });

  return (
    <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "4fr 3fr 5fr" }} gap="2">
      <Panel
        night
        gridColumn={{ md: "span 2", xl: "auto" }}
        minH={{ md: "56", xl: "80" }}
        display="flex"
        flexDirection="column"
      >
        <Contours inset="0" left="25%" opacity={0.3} />
        <Text textStyle="caption" color="night.muted" position="relative">
          {t("overview.fields", { zones: ZONE_IDS.length, crops: cropCount })}
        </Text>
        <Heading
          as="h1"
          position="relative"
          mt="3"
          mb={{ base: "6", md: "8" }}
          fontSize={{ base: "4xl", md: "6xl" }}
          fontWeight="300"
          letterSpacing="-0.03em"
          lineHeight="1.05"
        >
          {t("title")}
        </Heading>
        <Flex position="relative" mt="auto" justify="space-between" align="end" gap="4" wrap="wrap">
          <Box>
            <Text textStyle="caption" color="night.muted">
              {t("overview.farmTime")}
            </Text>
            <Text fontFamily="mono" fontSize="2xl" lineHeight="1.2" wordSpacing="-0.3em" data-farm-time>
              {now ? format.dateTime(now, { timeStyle: "short", timeZone: timeZone || undefined }) : "--:--"}
            </Text>
          </Box>
          <Status.Root
            colorPalette={connection === "connected" ? "green" : connection === "disconnected" ? "red" : "gray"}
            size="sm"
          >
            <Status.Indicator />
            <Text as="span" textStyle="caption">
              {t(`overview.${connection}`)}
            </Text>
          </Status.Root>
        </Flex>
      </Panel>

      <Panel night display="flex" flexDirection="column">
        <PanelLabel icon={LuSprout}>{t("summary.soil")}</PanelLabel>
        <Text
          data-summary={t("summary.soil")}
          textAlign={{ base: "left", md: "center" }}
          mt={{ base: "3", md: "4" }}
          mb={{ md: "2" }}
          fontSize={{ base: "5xl", md: "7xl" }}
          fontWeight="200"
          letterSpacing="-0.03em"
          lineHeight="1"
          fontVariantNumeric="tabular-nums"
        >
          {averageSoil === undefined ? "–" : `${format.number(averageSoil, { maximumFractionDigits: 0 })}%`}
        </Text>
        <Box mt="auto">
          <SoilGauge value={averageSoil} />
        </Box>
      </Panel>

      <Panel night display="flex" flexDirection="column" gap="3">
        <PanelLabel icon={LuActivity}>{t("overview.status")}</PanelLabel>
        <Grid
          templateColumns={{ base: "1fr", sm: "minmax(0, 1fr) minmax(0, 1fr)" }}
          gap={{ base: "3", sm: "6" }}
          flex="1"
        >
          <Stack gap="0">
            <Stat
              icon={LuWifi}
              label={t("summary.online")}
              value={`${ZONE_IDS.filter((id) => zones[id]?.online).length}/${ZONE_IDS.length}`}
            />
            <Stat icon={LuDroplets} label={t("summary.watering")} value={String(pumpingCount)} />
            <Stat icon={LuBellRing} label={t("summary.alarms")} value={String(alarmCount)} alert={alarmCount > 0} />
          </Stack>
          <Flex>
            <ZoneMap tiles={conditions} label={mapLabel} />
          </Flex>
        </Grid>
        <Wrap gap="3" rowGap="1" aria-label={t("legendTitle")} data-legend>
          {LEGEND.map((look) => (
            <HStack key={look} gap="1.5">
              <Box boxSize="2.5" bg={`field.${look}`} borderRadius="1px" />
              <Text textStyle="xs" color="night.muted">
                {t(`legend.${look}`)}
              </Text>
            </HStack>
          ))}
        </Wrap>
      </Panel>
    </Grid>
  );
}
