"use client";

import { Alert, Badge, Box, Button, Dialog, Flex, HStack, Menu, Portal, Stack, Text } from "@chakra-ui/react";
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
import { useTranslations } from "next-intl";
import { useState } from "react";
import { LuPlus } from "react-icons/lu";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { AddCropDialog } from "./add-crop-dialog";
import { AlarmBanners } from "./alarm-banners";
import { AlarmTimesDialog } from "./alarm-times-dialog";
import { AutomationDialog } from "./automation-dialog";
import { CropSection } from "./crop-section";
import { CropIcon } from "./crops";
import { DashboardOverview } from "./dashboard-overview";
import { SelectionBar } from "./selection-bar";
import { toaster } from "./toaster";
import { useFarm } from "./use-farm";
import { useFieldSelection } from "./use-field-selection";
import { ZoneCard, zoneLetter } from "./zone-card";

export function Dashboard() {
  const t = useTranslations("dashboard");
  const router = useRouter();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const tCrops = useTranslations("crops");
  const [confirmWater, setConfirmWater] = useState<{ title: string; zoneIds: string[]; alarms?: boolean } | null>(null);
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
    <Stack gap="2">
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

      <AlarmBanners
        alarms={alarms}
        pumping={pumping}
        allowed={allowed}
        connected={connected}
        pending={pending}
        onConfirm={(cycleId) => run(cycleId, () => confirmAlarm(cycleId))}
        onConfirmAll={() =>
          setConfirmWater({
            title: t("confirmAllTitle", { count: alarms.length }),
            zoneIds: alarms.map((alarm) => alarm.zoneId),
            alarms: true,
          })
        }
        onStop={(zoneId) => run(`stop:${zoneId}`, () => stopPump(zoneId))}
      />

      <DashboardOverview
        connection={connection}
        timeZone={timeZone}
        cropCount={crops.length}
        zones={zones}
        cycles={cycles}
        pumpingCount={pumping.length}
        alarmCount={alarms.length}
      />

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

      <Flex wrap="wrap" gap="2">
        {crops.map((crop, index) => {
          const members = zonesIn(crop.id);
          return (
            <CropSection
              key={crop.id}
              crop={crop}
              name={cropName(crop)}
              zoneCount={members.length}
              isFirst={index === 0}
              isLast={index === crops.length - 1}
              dragging={!!pointer}
              isDropTarget={dropTarget === crop.id && !!pointer}
              allowed={allowed}
              connected={connected}
              controlItems={bulkControlItems(members)}
              onEdit={() => setEditingCrop(crop)}
              onEditRules={() => setEditingRules(crop)}
              onEditTimes={() => setEditingTimes({ id: crop.id, name: cropName(crop), times: crop.alarmTimes })}
              onMove={(step) => moveSection(crop, step)}
              onRemove={() => handleRemoveCrop(crop)}
              onWater={() => askToWater(members, t("sectionWaterTitle", { section: cropName(crop) }))}
              onApply={(value) => applyBulk(members, value)}
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
            </CropSection>
          );
        })}
      </Flex>

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
          borderColor="ink/40"
          bg="ink/10"
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

      <SelectionBar
        count={allowed ? selectedIds.length : 0}
        connected={connected}
        controlItems={bulkControlItems(selectedIds)}
        moveItems={moveItems()}
        onClear={clear}
        onWater={() => askToWater(selectedIds, t("selectionWaterTitle", { count: selectedIds.length }))}
        onApply={(value) => applyBulk(selectedIds, value)}
      />
    </Stack>
  );
}
