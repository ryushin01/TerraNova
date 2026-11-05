"use client";

import {
  ActionBar,
  Alert,
  Badge,
  Box,
  Button,
  CloseButton,
  Dialog,
  Flex,
  Grid,
  Heading,
  HStack,
  Icon,
  IconButton,
  Menu,
  Portal,
  SimpleGrid,
  Stack,
  Text,
} from "@chakra-ui/react";
import {
  BUILTIN_CROP_NAMES,
  type ConfirmResult,
  type ControlResult,
  type Crop,
  type CropIconKey,
  canControl,
  MANUAL_ACTUATORS,
  type ManualActuator,
  ZONE_IDS,
} from "@terranova/shared";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { LuBell, LuBellRing, LuDroplets, LuEllipsisVertical, LuPlus, LuSprout, LuWifi } from "react-icons/lu";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { AddCropDialog } from "./add-crop-dialog";
import { AlarmTimesDialog } from "./alarm-times-dialog";
import { AutomationDialog } from "./automation-dialog";
import { CropIcon } from "./crops";
import { FieldLegend } from "./field-plot";
import { SummaryTile } from "./summary-tile";
import { toaster } from "./toaster";
import { useFarm } from "./use-farm";
import { useFieldSelection } from "./use-field-selection";
import { ZoneCard, zoneLetter } from "./zone-card";

export function Dashboard() {
  const t = useTranslations("dashboard");
  const format = useFormatter();
  const router = useRouter();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const tCrops = useTranslations("crops");
  const [confirmWater, setConfirmWater] = useState<{ title: string; zoneIds: string[]; alarms?: boolean } | null>(null);
  const [showAlarmList, setShowAlarmList] = useState(false);
  const [editingCrop, setEditingCrop] = useState<Crop | null>(null);
  const [editingRules, setEditingRules] = useState<Crop | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [addingCrop, setAddingCrop] = useState(false);
  const [editingTimes, setEditingTimes] = useState<{ id: string; name: string; times: string[] } | null>(null);
  const {
    connection,
    automationPauses,
    crops,
    timeZone,
    sections,
    zones,
    cycles,
    confirmAlarm,
    startWatering,
    moveZones,
    addCrop,
    updateCrop,
    setAutomation,
    resumeAutomation,
    reorderCrops,
    setAlarmTimes,
    removeCrop,
    stopPump,
    setActuator,
  } = useFarm(
    () => router.replace("/login"),
    (cycle) => {
      if (cycle.state === "completed" && cycle.reason === "duration_elapsed") {
        toaster.create({ type: "success", title: t("wateringDone", { zone: zoneLetter(cycle.zoneId) }) });
      }
    },
  );
  const [pending, setPending] = useState<Set<string>>(new Set());

  const connected = connection === "connected";
  const allowed = canControl(session?.user.role);
  const cropName = (crop: Crop) =>
    crop.name === BUILTIN_CROP_NAMES[crop.id] && tCrops.has(crop.id as never) ? tCrops(crop.id as never) : crop.name;
  const { selected, toggle, clear, marquee, pointer, dropTarget } = useFieldSelection(allowed, (zoneIds, cropId) => {
    const moving = zoneIds.filter((id) => sections[id] !== cropId);
    if (moving.length > 0) run(`move:${moving.join()}`, () => moveZones(moving, cropId));
  });
  const selectedIds = ZONE_IDS.filter((id) => selected.has(id));
  const readOnly = !sessionPending && !!session && !allowed;

  const alarms = ZONE_IDS.flatMap((id) => {
    const cycle = cycles[id];
    return cycle?.state === "alarm_sent" ? [cycle] : [];
  });
  const pumping = ZONE_IDS.filter((id) => {
    const state = cycles[id]?.state;
    return zones[id]?.telemetry?.actuators.pump || state === "command_sent" || state === "watering";
  });

  const soilValues = ZONE_IDS.flatMap((id) => {
    const soil = zones[id]?.online ? zones[id]?.telemetry?.soilMoisturePct : undefined;
    return soil === undefined ? [] : [soil];
  });
  const averageSoil = soilValues.length
    ? `${format.number(soilValues.reduce((total, soil) => total + soil, 0) / soilValues.length, { maximumFractionDigits: 0 })}%`
    : "–";

  /** Runs one control at a time per key, so a double tap can't send it twice. */
  const run = async (key: string, action: () => Promise<ConfirmResult | ControlResult>) => {
    if (pending.has(key)) return;
    setPending((prev) => new Set(prev).add(key));
    const result = await action();
    // already_handled is not an error: someone else acted and the field shows the outcome.
    if (!result.ok && result.error !== "already_handled") {
      toaster.create({ type: "error", title: t(`controlError.${result.error}`) });
    }
    setPending((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const zonesIn = (cropId: string): string[] => ZONE_IDS.filter((id) => sections[id] === cropId);

  /** Acts on each zone separately: one zone's failure must not stop the others. */
  const runZones = async <T extends ConfirmResult | ControlResult>(
    zoneIds: string[],
    action: (zoneId: string) => Promise<T>,
    summarize?: (results: T[]) => string,
  ) => {
    const key = `bulk:${zoneIds.join()}`;
    if (pending.has(key)) return;
    setPending((prev) => new Set(prev).add(key));
    const results = await Promise.all(zoneIds.map(action));
    setPending((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (summarize) {
      toaster.create({ type: "info", title: summarize(results) });
    } else if (results.some((result) => !result.ok)) {
      toaster.create({ type: "error", title: t("bulkPartial") });
    }
  };

  const summarizeWatering = (results: ConfirmResult[]) => {
    const started = results.filter((r) => r.ok && r.cycle.state === "command_sent").length;
    return t("bulkWaterResult", { started, excluded: results.length - started });
  };

  const waterZones = (zoneIds: string[]) => runZones(zoneIds, startWatering, summarizeWatering);

  const confirmAlarms = (zoneIds: string[]) =>
    runZones(zoneIds, (zoneId) => confirmAlarm(cycles[zoneId]!.id), summarizeWatering);

  const moveSection = (crop: Crop, step: -1 | 1) => {
    const ids = crops.map(({ id }) => id);
    const from = ids.indexOf(crop.id);
    const to = from + step;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    run(`reorder:${crop.id}`, () => reorderCrops(ids));
  };

  /** Runs a value from the bulk menu items on a group of zones. */
  const applyBulk = (zoneIds: string[], value: string) => {
    if (value === "stop") {
      runZones(zoneIds, stopPump);
    } else if (value.startsWith("move:")) {
      run(`move:${zoneIds.join()}`, () => moveZones(zoneIds, value.slice("move:".length)));
    } else {
      const [actuator, state] = value.split(":") as [ManualActuator, string];
      runZones(zoneIds, (zoneId) => setActuator(zoneId, actuator, state === "on"));
    }
  };

  const askToWater = (zoneIds: string[], title: string) => setConfirmWater({ title, zoneIds });

  const bulkControlItems = (zoneIds: string[]) => [
    zoneIds.some((id) => pumping.includes(id as (typeof ZONE_IDS)[number])) ? (
      <Menu.Item key="stop" value="stop" color="fg.error">
        {t("bulkStop")}
      </Menu.Item>
    ) : null,
    ...MANUAL_ACTUATORS.flatMap((actuator) => [
      <Menu.Item key={`${actuator}:on`} value={`${actuator}:on`}>
        {t(`section.${actuator}On`)}
      </Menu.Item>,
      <Menu.Item key={`${actuator}:off`} value={`${actuator}:off`}>
        {t(`section.${actuator}Off`)}
      </Menu.Item>,
    ]),
  ];

  const moveItems = (exclude?: string) =>
    crops
      .filter((crop) => crop.id !== exclude)
      .map((crop) => (
        <Menu.Item key={crop.id} value={`move:${crop.id}`}>
          <CropIcon icon={crop.icon} boxSize="5" />
          {t("menu.moveTo", { section: cropName(crop) })}
        </Menu.Item>
      ));

  const handleAddCrop = async (name: string, icon: CropIconKey) => {
    const result = await addCrop(name, icon);
    if (result.ok) toaster.create({ type: "success", title: t("cropAdded", { name }) });
    return result;
  };

  const handleUpdateCrop = async (name: string, icon: CropIconKey) => {
    const result = await updateCrop(editingCrop!.id, name, icon);
    if (result.ok) toaster.create({ type: "success", title: t("cropUpdated", { name }) });
    return result;
  };

  const handleRemoveCrop = async (crop: Crop) => {
    const result = await removeCrop(crop.id);
    if (!result.ok) toaster.create({ type: "error", title: t("cropRemoveFailed") });
  };

  return (
    <Stack gap="6">
      {connection === "disconnected" && (
        <Alert.Root status="error">
          <Alert.Indicator />
          <Alert.Title>{t("disconnected")}</Alert.Title>
        </Alert.Root>
      )}
      {readOnly && (
        <Alert.Root status="neutral">
          <Alert.Indicator />
          <Alert.Title>{t("readOnly")}</Alert.Title>
        </Alert.Root>
      )}

      {(alarms.length > 0 || pumping.length > 0) && (
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
                <Button
                  size="lg"
                  colorPalette="orange"
                  data-confirm-all
                  disabled={!connected}
                  onClick={() =>
                    setConfirmWater({
                      title: t("confirmAllTitle", { count: alarms.length }),
                      zoneIds: alarms.map((alarm) => alarm.zoneId),
                      alarms: true,
                    })
                  }
                >
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
                    onClick={() => run(alarm.id, () => confirmAlarm(alarm.id))}
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
                  onClick={() => run(`stop:${zoneId}`, () => stopPump(zoneId))}
                >
                  {t("stop")}
                </Button>
              )}
            </Alert.Root>
          ))}
        </Stack>
      )}

      <SimpleGrid columns={{ base: 2, md: 4 }} gap="2">
        <SummaryTile
          dark
          icon={LuWifi}
          label={t("summary.online")}
          value={`${ZONE_IDS.filter((id) => zones[id]?.online).length} / ${ZONE_IDS.length}`}
        />
        <SummaryTile icon={LuDroplets} label={t("summary.watering")} value={String(pumping.length)} />
        <SummaryTile icon={LuBellRing} label={t("summary.alarms")} value={String(alarms.length)} />
        <SummaryTile icon={LuSprout} label={t("summary.soil")} value={averageSoil} />
      </SimpleGrid>

      {allowed && (
        <Flex justify="space-between" align="center" gap="3" wrap="wrap">
          <Text textStyle="sm" color="fg.muted" hideBelow="md">
            {t("selectionHint")}
          </Text>
          <HStack gap="2" ms="auto">
            <Button
              variant={selecting ? "solid" : "outline"}
              data-select-mode
              aria-pressed={selecting}
              onClick={() => {
                if (selecting) clear();
                setSelecting(!selecting);
              }}
            >
              {t(selecting ? "selectModeOff" : "selectModeOn")}
            </Button>
            <Button variant="outline" data-add-crop disabled={!connected} onClick={() => setAddingCrop(true)}>
              <LuPlus aria-hidden />
              {t("addCrop")}
            </Button>
          </HStack>
        </Flex>
      )}

      {crops.map((crop) => {
        const members = zonesIn(crop.id);
        const isDropTarget = dropTarget === crop.id && !!pointer;
        return (
          <Stack
            as="section"
            key={crop.id}
            data-section={crop.id}
            data-drop-target={isDropTarget || undefined}
            aria-label={cropName(crop)}
            gap="3"
            p="3"
            // The drop outline sits outside the content, which stays aligned with the rest of the page.
            mx="calc(var(--chakra-spacing-3) * -1 - 2px)"
            borderRadius="lg"
            borderWidth="2px"
            borderStyle="dashed"
            borderColor={isDropTarget ? "copper" : pointer ? "brand.emphasized" : "transparent"}
            bg={isDropTarget ? "brand.subtle" : undefined}
          >
            <Flex align="center" justify="space-between" gap="2" wrap="wrap">
              <HStack gap="2">
                <CropIcon icon={crop.icon} boxSize="8" data-section-icon={crop.icon} />
                <Heading as="h2" fontSize="2xl" fontWeight="800" letterSpacing="-0.02em">
                  {cropName(crop)}
                </Heading>
                <Badge variant="subtle">{t("sectionCount", { count: members.length })}</Badge>
                {allowed && (
                  <Menu.Root
                    lazyMount
                    unmountOnExit
                    onSelect={({ value }) => {
                      if (value === "edit") setEditingCrop(crop);
                      else if (value === "automation") setEditingRules(crop);
                      else moveSection(crop, value === "up" ? -1 : 1);
                    }}
                  >
                    <Menu.Trigger asChild>
                      <IconButton
                        variant="ghost"
                        size="sm"
                        data-section-more={crop.id}
                        aria-label={t("sectionMore", { section: cropName(crop) })}
                        disabled={!connected}
                      >
                        <LuEllipsisVertical />
                      </IconButton>
                    </Menu.Trigger>
                    <Portal>
                      <Menu.Positioner>
                        <Menu.Content data-section-more-items={crop.id}>
                          <Menu.Item value="edit">{t("editCrop")}</Menu.Item>
                          <Menu.Item value="automation">{t("automation")}</Menu.Item>
                          <Menu.Item value="up" disabled={crops[0]?.id === crop.id}>
                            {t("moveUp")}
                          </Menu.Item>
                          <Menu.Item value="down" disabled={crops.at(-1)?.id === crop.id}>
                            {t("moveDown")}
                          </Menu.Item>
                        </Menu.Content>
                      </Menu.Positioner>
                    </Portal>
                  </Menu.Root>
                )}
              </HStack>
              {allowed && members.length > 0 && (
                <HStack gap="2">
                  <Button
                    data-section-water={crop.id}
                    disabled={!connected}
                    onClick={() => askToWater(members, t("sectionWaterTitle", { section: cropName(crop) }))}
                  >
                    {t("sectionWater")}
                  </Button>
                  <Menu.Root lazyMount unmountOnExit onSelect={({ value }) => applyBulk(members, value)}>
                    <Menu.Trigger asChild>
                      <Button variant="outline" data-section-menu={crop.id} disabled={!connected}>
                        {t("sectionControl")}
                      </Button>
                    </Menu.Trigger>
                    <Portal>
                      <Menu.Positioner>
                        <Menu.Content data-section-items={crop.id}>{bulkControlItems(members)}</Menu.Content>
                      </Menu.Positioner>
                    </Portal>
                  </Menu.Root>
                </HStack>
              )}
              {allowed && members.length === 0 && (
                <Button variant="ghost" size="sm" data-section-remove={crop.id} onClick={() => handleRemoveCrop(crop)}>
                  {t("sectionRemove")}
                </Button>
              )}
            </Flex>
            <HStack gap="2" textStyle="sm" color="fg.muted">
              <Icon as={LuBell} aria-hidden />
              <Text data-section-times={crop.id}>
                {crop.alarmTimes.length > 0 ? crop.alarmTimes.join(", ") : t("noAlarmTimes")}
              </Text>
              {Object.values(crop.automation).some((rule) => rule !== null) && (
                <Badge data-section-auto={crop.id}>{t("automationOn")}</Badge>
              )}
              {allowed && (
                <Button
                  variant="ghost"
                  size="xs"
                  data-section-times-edit={crop.id}
                  aria-label={t("editAlarmTimes", { section: cropName(crop) })}
                  disabled={!connected}
                  onClick={() => setEditingTimes({ id: crop.id, name: cropName(crop), times: crop.alarmTimes })}
                >
                  {t("change")}
                </Button>
              )}
            </HStack>
            {members.length === 0 ? (
              <Text textStyle="sm" color="fg.muted">
                {t("sectionEmpty")}
              </Text>
            ) : (
              <Grid
                as="ul"
                listStyleType="none"
                templateColumns={{
                  base: "1fr",
                  md: "repeat(auto-fill, minmax(340px, 1fr))",
                  xl: "repeat(auto-fill, minmax(480px, 1fr))",
                }}
                gap="2"
              >
                {members.map((zoneId) => (
                  <li key={zoneId}>
                    <ZoneCard
                      zoneId={zoneId}
                      crop={crop}
                      selected={selected.has(zoneId)}
                      selecting={selecting}
                      pauses={automationPauses}
                      timeZone={timeZone}
                      onToggleSelect={() => toggle(zoneId)}
                      dragging={!!pointer && selected.has(zoneId)}
                      group={selected.has(zoneId) && selectedIds.length > 1 ? selectedIds : null}
                      bulkItems={bulkControlItems}
                      moveItems={moveItems}
                      zone={zones[zoneId]}
                      cycle={cycles[zoneId]}
                      disconnected={connection === "disconnected"}
                      allowed={allowed}
                      pending={pending}
                      onResume={(actuator) =>
                        run(`resume:${zoneId}:${actuator}`, () => resumeAutomation(zoneId, actuator))
                      }
                      onWater={() => run(`water:${zoneId}`, () => startWatering(zoneId))}
                      onWaterGroup={(ids) => askToWater(ids, t("selectionWaterTitle", { count: ids.length }))}
                      onBulk={applyBulk}
                      onStop={() => run(`stop:${zoneId}`, () => stopPump(zoneId))}
                      onMove={(target) => run(`move:${zoneId}`, () => moveZones([zoneId], target))}
                      onSwitch={(actuator, on) => run(`${zoneId}:${actuator}`, () => setActuator(zoneId, actuator, on))}
                    />
                  </li>
                ))}
              </Grid>
            )}
          </Stack>
        );
      })}

      <Dialog.Root
        role="alertdialog"
        open={!!confirmWater}
        onOpenChange={(event) => {
          if (!event.open) setConfirmWater(null);
        }}
      >
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content mx="4">
              <Dialog.Header>
                <Dialog.Title>{confirmWater?.title}</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                {confirmWater && t("sectionWaterBody", { zones: confirmWater.zoneIds.map(zoneLetter).join(", ") })}
              </Dialog.Body>
              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">{t("cancel")}</Button>
                </Dialog.ActionTrigger>
                <Button
                  data-water-confirm
                  onClick={() => {
                    if (confirmWater?.alarms) confirmAlarms(confirmWater.zoneIds);
                    else if (confirmWater) waterZones(confirmWater.zoneIds);
                    setConfirmWater(null);
                  }}
                >
                  {t("sectionWater")}
                </Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      <AlarmTimesDialog
        section={editingTimes}
        timeZone={timeZone}
        onClose={() => setEditingTimes(null)}
        onSave={(times) => setAlarmTimes(editingTimes!.id, times)}
      />

      <AutomationDialog
        section={editingRules && { name: cropName(editingRules), rules: editingRules.automation }}
        onClose={() => setEditingRules(null)}
        onSave={(rules) => setAutomation(editingRules!.id, rules)}
      />

      <AddCropDialog open={addingCrop} onClose={() => setAddingCrop(false)} onSubmit={handleAddCrop} />
      <AddCropDialog
        open={!!editingCrop}
        editing={editingCrop}
        onClose={() => setEditingCrop(null)}
        onSubmit={handleUpdateCrop}
      />

      {/* These follow the pointer, so positions stay inline: as style props, every pixel would
          add a permanent CSS rule to Emotion's cache. */}
      {marquee && (
        <Box
          data-marquee
          position="fixed"
          zIndex="overlay"
          pointerEvents="none"
          borderWidth="1px"
          borderColor="copper"
          bg="copper/15"
          style={marquee}
        />
      )}
      {pointer && (
        <Badge
          data-drag-ghost
          position="fixed"
          zIndex="overlay"
          pointerEvents="none"
          size="lg"
          variant="solid"
          style={{ left: pointer.x + 12, top: pointer.y + 12 }}
        >
          {t("dragLabel", { count: selectedIds.length })}
        </Badge>
      )}

      <ActionBar.Root
        open={allowed && selectedIds.length > 0}
        onOpenChange={(event) => {
          if (!event.open) clear();
        }}
        closeOnInteractOutside={false}
      >
        <Portal>
          <ActionBar.Positioner>
            <ActionBar.Content data-selection-bar flexWrap="wrap">
              <ActionBar.SelectionTrigger data-selection-count>
                {t("selectionCount", { count: selectedIds.length })}
              </ActionBar.SelectionTrigger>
              <ActionBar.Separator />
              <Button
                size="sm"
                data-selection-water
                disabled={!connected}
                onClick={() => askToWater(selectedIds, t("selectionWaterTitle", { count: selectedIds.length }))}
              >
                {t("menu.water")}
              </Button>
              <Menu.Root lazyMount unmountOnExit onSelect={({ value }) => applyBulk(selectedIds, value)}>
                <Menu.Trigger asChild>
                  <Button size="sm" variant="outline" data-selection-control disabled={!connected}>
                    {t("sectionControl")}
                  </Button>
                </Menu.Trigger>
                <Portal>
                  <Menu.Positioner>
                    <Menu.Content data-selection-control-items>{bulkControlItems(selectedIds)}</Menu.Content>
                  </Menu.Positioner>
                </Portal>
              </Menu.Root>
              <Menu.Root lazyMount unmountOnExit onSelect={({ value }) => applyBulk(selectedIds, value)}>
                <Menu.Trigger asChild>
                  <Button size="sm" variant="outline" data-selection-move disabled={!connected}>
                    {t("menu.moveLabel")}
                  </Button>
                </Menu.Trigger>
                <Portal>
                  <Menu.Positioner>
                    <Menu.Content data-selection-move-items>{moveItems()}</Menu.Content>
                  </Menu.Positioner>
                </Portal>
              </Menu.Root>
              <ActionBar.CloseTrigger asChild>
                <CloseButton size="sm" aria-label={t("selectionClear")} />
              </ActionBar.CloseTrigger>
            </ActionBar.Content>
          </ActionBar.Positioner>
        </Portal>
      </ActionBar.Root>

      <FieldLegend />
    </Stack>
  );
}
