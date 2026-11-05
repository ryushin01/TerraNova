"use client";

import {
  Badge,
  Button,
  Flex,
  Grid,
  Heading,
  HStack,
  Icon,
  IconButton,
  Menu,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import type { Crop } from "@terranova/shared";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { LuBell, LuEllipsisVertical } from "react-icons/lu";
import { CropIcon } from "./crops";

interface Props {
  crop: Crop;
  /** The crop's name in the current language. */
  name: string;
  zoneCount: number;
  isFirst: boolean;
  isLast: boolean;
  /** Fields are being dragged somewhere on the page. */
  dragging: boolean;
  isDropTarget: boolean;
  allowed: boolean;
  connected: boolean;
  controlItems: ReactNode;
  onEdit: () => void;
  onEditRules: () => void;
  onEditTimes: () => void;
  onMove: (step: -1 | 1) => void;
  onRemove: () => void;
  onWater: () => void;
  /** Runs a value from the section's control menu on its zones. */
  onApply: (value: string) => void;
  /** One list item per zone. */
  children: ReactNode;
}

/** One crop: its heading and controls, its alarm times, and its zones. */
export function CropSection({
  crop,
  name,
  zoneCount,
  isFirst,
  isLast,
  dragging,
  isDropTarget,
  allowed,
  connected,
  controlItems,
  onEdit,
  onEditRules,
  onEditTimes,
  onMove,
  onRemove,
  onWater,
  onApply,
  children,
}: Props) {
  const t = useTranslations("dashboard");

  return (
    <Stack
      as="section"
      data-section={crop.id}
      data-drop-target={isDropTarget || undefined}
      aria-label={name}
      gap="3"
      p="3"
      // The drop outline sits outside the content, which stays aligned with the rest of the page.
      mx="calc(var(--chakra-spacing-3) * -1 - 2px)"
      borderRadius="lg"
      borderWidth="2px"
      borderStyle="dashed"
      borderColor={isDropTarget ? "copper" : dragging ? "brand.emphasized" : "transparent"}
      bg={isDropTarget ? "brand.subtle" : undefined}
    >
      <Flex align="center" justify="space-between" gap="2" wrap="wrap">
        <HStack gap="2">
          <CropIcon icon={crop.icon} boxSize="8" data-section-icon={crop.icon} />
          <Heading as="h2" fontSize="2xl" fontWeight="800" letterSpacing="-0.02em">
            {name}
          </Heading>
          <Badge variant="subtle">{t("sectionCount", { count: zoneCount })}</Badge>
          {allowed && (
            <Menu.Root
              lazyMount
              unmountOnExit
              onSelect={({ value }) => {
                if (value === "edit") onEdit();
                else if (value === "automation") onEditRules();
                else onMove(value === "up" ? -1 : 1);
              }}
            >
              <Menu.Trigger asChild>
                <IconButton
                  variant="ghost"
                  size="sm"
                  data-section-more={crop.id}
                  aria-label={t("sectionMore", { section: name })}
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
                    <Menu.Item value="up" disabled={isFirst}>
                      {t("moveUp")}
                    </Menu.Item>
                    <Menu.Item value="down" disabled={isLast}>
                      {t("moveDown")}
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Positioner>
              </Portal>
            </Menu.Root>
          )}
        </HStack>
        {allowed && zoneCount > 0 && (
          <HStack gap="2">
            <Button data-section-water={crop.id} disabled={!connected} onClick={onWater}>
              {t("sectionWater")}
            </Button>
            <Menu.Root lazyMount unmountOnExit onSelect={({ value }) => onApply(value)}>
              <Menu.Trigger asChild>
                <Button variant="outline" data-section-menu={crop.id} disabled={!connected}>
                  {t("sectionControl")}
                </Button>
              </Menu.Trigger>
              <Portal>
                <Menu.Positioner>
                  <Menu.Content data-section-items={crop.id}>{controlItems}</Menu.Content>
                </Menu.Positioner>
              </Portal>
            </Menu.Root>
          </HStack>
        )}
        {allowed && zoneCount === 0 && (
          <Button variant="ghost" size="sm" data-section-remove={crop.id} onClick={onRemove}>
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
            aria-label={t("editAlarmTimes", { section: name })}
            disabled={!connected}
            onClick={onEditTimes}
          >
            {t("change")}
          </Button>
        )}
      </HStack>
      {zoneCount === 0 ? (
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
          {children}
        </Grid>
      )}
    </Stack>
  );
}
