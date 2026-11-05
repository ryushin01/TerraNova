"use client";

import {
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  DataList,
  Flex,
  Grid,
  HStack,
  Icon,
  IconButton,
  Menu,
  Portal,
  Progress,
  Stack,
  Status,
  Switch,
  Text,
} from "@chakra-ui/react";
import {
  type AutomationPauses,
  type Crop,
  MANUAL_ACTUATORS,
  type ManualActuator,
  SOIL_SUFFICIENT_PCT,
  type WateringCycle,
  type WateringState,
  type ZoneSnapshot,
} from "@terranova/shared";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { IconType } from "react-icons";
import {
  LuDroplets,
  LuEllipsisVertical,
  LuLightbulb,
  LuListChecks,
  LuThermometer,
  LuWaves,
  LuWind,
} from "react-icons/lu";
import { FieldPlot, fieldLook } from "./field-plot";
import { chamfer } from "./theme";

const STATE_COLORS: Record<WateringState, string> = {
  alarm_sent: "orange",
  confirmed: "yellow",
  command_sent: "yellow",
  watering: "blue",
  completed: "green",
  failed: "red",
  timed_out: "red",
  skipped: "gray",
};

export const zoneLetter = (zoneId: string) => zoneId.replace("zone-", "").toUpperCase();

export interface ZoneCardProps {
  zoneId: string;
  crop: Crop;
  selected: boolean;
  selecting: boolean;
  pauses: AutomationPauses;
  timeZone: string;
  onToggleSelect: () => void;
  dragging: boolean;
  /** All selected zones, when this card is part of a selection of two or more. */
  group: string[] | null;
  bulkItems: (zoneIds: string[]) => ReactNode;
  moveItems: (exclude?: string) => ReactNode;
  zone: ZoneSnapshot | undefined;
  cycle: WateringCycle | undefined;
  disconnected: boolean;
  allowed: boolean;
  pending: Set<string>;
  onResume: (actuator: ManualActuator) => void;
  onWater: () => void;
  onStop: () => void;
  onWaterGroup: (zoneIds: string[]) => void;
  onBulk: (zoneIds: string[], value: string) => void;
  onMove: (cropId: string) => void;
  onSwitch: (actuator: ManualActuator, on: boolean) => void;
}

export function ZoneCard({
  zoneId,
  crop,
  selected,
  selecting,
  pauses,
  timeZone,
  onToggleSelect,
  dragging,
  group,
  bulkItems,
  moveItems,
  zone,
  cycle,
  disconnected,
  allowed,
  pending,
  onResume,
  onWater,
  onStop,
  onWaterGroup,
  onBulk,
  onMove,
  onSwitch,
}: ZoneCardProps) {
  const t = useTranslations("dashboard");
  const format = useFormatter();
  const telemetry = zone?.telemetry;
  const online = !disconnected && !!zone?.online;
  // Until the first snapshot arrives the zone's condition is simply unknown, not offline.
  const showOffline = disconnected || (!!zone && !zone.online);

  const stopped = cycle?.state === "completed" && cycle.reason === "stopped_by_command";
  const palette = !cycle || stopped ? "gray" : STATE_COLORS[cycle.state];
  const stateKey = stopped ? "stopped" : (cycle?.state ?? "idle");
  const stateLabel = t(`state.${stateKey}`);
  const reasonKey = `reason.${cycle?.reason}`;
  const showReason =
    !!cycle && ["failed", "timed_out", "skipped", "completed"].includes(cycle.state) && t.has(reasonKey as never);

  const value = (number: number | undefined, unit: string) =>
    number === undefined ? "–" : `${format.number(number, { maximumFractionDigits: 1 })}${unit}`;
  const soil = telemetry?.soilMoisturePct;
  const look = fieldLook({ state: cycle?.state, stopped, online, soil });
  const zoneName = zoneLetter(zoneId);
  const pumping =
    !!telemetry?.actuators.pump ||
    cycle?.state === "confirmed" ||
    cycle?.state === "command_sent" ||
    cycle?.state === "watering";
  const soilSufficient = soil !== undefined && soil >= SOIL_SUFFICIENT_PCT;

  /** Only worth mentioning where a rule would otherwise act on this device. */
  const pausedUntil = (actuator: ManualActuator) => {
    const { ventOnAboveC, ventOnAboveHumidityPct, lightOnAt } = crop.automation;
    const hasRule = actuator === "vent" ? ventOnAboveC !== null || ventOnAboveHumidityPct !== null : lightOnAt !== null;
    const until = pauses[`${zoneId}|${actuator}`];
    return hasRule && until && Date.parse(until) > Date.now() ? until : null;
  };

  const handleMenu = (value: string) => {
    if (group) {
      if (value === "water") onWaterGroup(group);
      else onBulk(group, value);
    } else if (value === "water") onWater();
    else if (value === "stop") onStop();
    else if (value === "vent" || value === "light") onSwitch(value, !telemetry?.actuators[value]);
    else if (value.startsWith("move:")) onMove(value.slice("move:".length));
  };

  const plotLabel = t("plotLabel", {
    zone: zoneName,
    state: stateLabel,
    soil: soil === undefined ? t("soilUnknown") : value(soil, "%"),
  });

  const plot = <FieldPlot look={look} label={plotLabel} icon={crop.icon} />;
  const menuContent = (
    <Portal>
      <Menu.Positioner>
        <Menu.Content data-zone-menu={zoneId}>
          <Menu.ItemGroup>
            <Menu.ItemGroupLabel>
              {group ? t("selectionCount", { count: group.length }) : t("zone", { id: zoneName })}
            </Menu.ItemGroupLabel>
            {group ? (
              <Menu.Item value="water">{t("menu.water")}</Menu.Item>
            ) : (
              <Menu.Item value="water" disabled={!online || pumping || soilSufficient}>
                {soilSufficient ? t("menu.waterNotNeeded") : t("menu.water")}
              </Menu.Item>
            )}
            {!group && pumping && (
              <Menu.Item value="stop" color="fg.error">
                {t("stop")}
              </Menu.Item>
            )}
          </Menu.ItemGroup>
          <Menu.Separator />
          <Menu.ItemGroup>
            {group
              ? bulkItems(group)
              : MANUAL_ACTUATORS.map((actuator) => (
                  <Menu.Item key={actuator} value={actuator} disabled={!online}>
                    {t(`menu.${actuator}${telemetry?.actuators[actuator] ? "Off" : "On"}`)}
                  </Menu.Item>
                ))}
          </Menu.ItemGroup>
          <Menu.Separator />
          <Menu.ItemGroup>
            <Menu.ItemGroupLabel>{t("menu.moveLabel")}</Menu.ItemGroupLabel>
            {moveItems(group ? undefined : crop.id)}
          </Menu.ItemGroup>
        </Menu.Content>
      </Menu.Positioner>
    </Portal>
  );

  return (
    <Card.Root
      variant="elevated"
      boxShadow={selected ? "inset 0 0 0 2px var(--chakra-colors-copper)" : "none"}
      border="none"
      borderRadius="0"
      style={{ clipPath: chamfer() }}
      data-zone={zoneId}
      data-state={cycle?.state ?? "idle"}
      data-selected={selected || undefined}
      h="full"
      userSelect="none"
      cursor={selected ? "grab" : undefined}
      opacity={dragging ? 0.5 : 1}
    >
      <Card.Body gap="3" p="4">
        <Flex justify="space-between" align="center" gap="2">
          <HStack gap="2">
            {selecting && (
              <Checkbox.Root
                size="lg"
                data-select-zone={zoneId}
                checked={selected}
                onCheckedChange={onToggleSelect}
                aria-label={t("selectZone", { zone: zoneName })}
              >
                <Checkbox.HiddenInput aria-label={t("selectZone", { zone: zoneName })} />
                <Checkbox.Control />
              </Checkbox.Root>
            )}
            <Card.Title fontWeight="800" fontSize="lg" letterSpacing="-0.01em">
              {t("zone", { id: zoneName })}
            </Card.Title>
            <Badge colorPalette={palette} variant={palette === "gray" ? "subtle" : "solid"}>
              {stateLabel}
            </Badge>
          </HStack>
          <HStack gap="1">
            {(online || showOffline) && (
              <Status.Root colorPalette={online ? "green" : "gray"} size="sm">
                <Status.Indicator />
                {t(online ? "online" : "offline")}
              </Status.Root>
            )}
            {allowed && (
              <Menu.Root lazyMount unmountOnExit onSelect={({ value }) => handleMenu(value)}>
                <Menu.Trigger asChild>
                  <IconButton
                    variant="ghost"
                    colorPalette="gray"
                    size="md"
                    aria-label={t("menu.open", { zone: zoneName })}
                    data-menu-button={zoneId}
                  >
                    <LuEllipsisVertical />
                  </IconButton>
                </Menu.Trigger>
                {menuContent}
              </Menu.Root>
            )}
          </HStack>
        </Flex>

        <Grid templateColumns={{ base: "1fr", xl: "minmax(0, 1.15fr) minmax(0, 1fr)" }} gap="4">
          <Stack gap="2">
            {allowed ? (
              <Menu.Root lazyMount unmountOnExit onSelect={({ value }) => handleMenu(value)}>
                <Menu.ContextTrigger asChild>
                  <Box data-plot-menu={zoneId} w="full" display="block" cursor="context-menu" userSelect="none">
                    {plot}
                  </Box>
                </Menu.ContextTrigger>
                {menuContent}
              </Menu.Root>
            ) : (
              plot
            )}
            {showReason && <Text textStyle="xs">{t(reasonKey as never)}</Text>}
          </Stack>

          <Stack gap="3">
            <Progress.Root
              value={soil ?? null}
              min={0}
              max={100}
              size="sm"
              colorPalette="teal"
              opacity={online ? 1 : 0.5}
            >
              <Flex justify="space-between" mb="1">
                <Progress.Label textStyle="sm" fontWeight="normal" color="fg.muted">
                  <HStack gap="1.5">
                    <Icon as={LuWaves} aria-hidden />
                    {t("soil")}
                  </HStack>
                </Progress.Label>
                <Text textStyle="sm" fontWeight="semibold" fontVariantNumeric="tabular-nums">
                  {value(soil, "%")}
                </Text>
              </Flex>
              <Progress.Track borderRadius="full">
                <Progress.Range />
              </Progress.Track>
            </Progress.Root>

            <DataList.Root orientation="horizontal" size="sm" gap="1" opacity={online ? 1 : 0.5}>
              <Reading icon={LuThermometer} label={t("temperature")} value={value(telemetry?.temperatureC, "°C")} />
              <Reading icon={LuDroplets} label={t("humidity")} value={value(telemetry?.humidityPct, "%")} />
              <Reading
                icon={LuListChecks}
                label={t("pump")}
                value={telemetry ? t(telemetry.actuators.pump ? "on" : "off") : "–"}
              />
            </DataList.Root>

            <Stack gap="0">
              {MANUAL_ACTUATORS.map((actuator) => {
                const until = pausedUntil(actuator);
                return (
                  <Box key={actuator}>
                    <Switch.Root
                      data-actuator={actuator}
                      size="md"
                      minH="10"
                      w="full"
                      justifyContent="space-between"
                      // Shows what the device reports, so the switch can't claim a change that didn't happen.
                      checked={!!telemetry?.actuators[actuator]}
                      disabled={!allowed || !online || pending.has(`${zoneId}:${actuator}`)}
                      onCheckedChange={(event) => onSwitch(actuator, event.checked)}
                    >
                      <Switch.HiddenInput />
                      <Switch.Label fontWeight="normal">
                        <HStack gap="1.5">
                          <Icon as={actuator === "vent" ? LuWind : LuLightbulb} color="fg.muted" aria-hidden />
                          {t(actuator)}
                        </HStack>
                      </Switch.Label>
                      <Switch.Control />
                    </Switch.Root>
                    {until && (
                      <Flex align="center" justify="space-between" gap="2" mb="1">
                        <Text textStyle="xs" color="fg.muted" data-automation-paused={actuator}>
                          {t("automationPaused", {
                            time: format.dateTime(new Date(until), {
                              timeStyle: "short",
                              timeZone: timeZone || undefined,
                            }),
                          })}
                        </Text>
                        {allowed && (
                          <Button
                            size="2xs"
                            variant="outline"
                            flexShrink={0}
                            data-automation-resume={actuator}
                            disabled={!online}
                            onClick={() => onResume(actuator)}
                          >
                            {t("automationResume")}
                          </Button>
                        )}
                      </Flex>
                    )}
                  </Box>
                );
              })}
            </Stack>
          </Stack>
        </Grid>

        {showOffline && zone?.lastSeenAt && (
          <Text textStyle="xs" color="fg.muted">
            {t("lastSeen", {
              time: format.dateTime(new Date(zone.lastSeenAt), { timeStyle: "medium" }),
            })}
          </Text>
        )}
      </Card.Body>
    </Card.Root>
  );
}

function Reading({ icon, label, value }: { icon: IconType; label: string; value: string }) {
  return (
    <DataList.Item justifyContent="space-between">
      <DataList.ItemLabel>
        <HStack gap="1.5">
          <Icon as={icon} aria-hidden />
          {label}
        </HStack>
      </DataList.ItemLabel>
      <DataList.ItemValue flex="none" fontVariantNumeric="tabular-nums">
        {value}
      </DataList.ItemValue>
    </DataList.Item>
  );
}
