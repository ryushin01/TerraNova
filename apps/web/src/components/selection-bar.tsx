"use client";

import { ActionBar, Button, CloseButton, Menu, Portal } from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

interface Props {
  count: number;
  connected: boolean;
  controlItems: ReactNode;
  moveItems: ReactNode;
  onClear: () => void;
  onWater: () => void;
  /** Runs a value from the control or move menu on the selected zones. */
  onApply: (value: string) => void;
}

/** Actions for the selected zones. It opens with a selection and closes without one. */
export function SelectionBar({ count, connected, controlItems, moveItems, onClear, onWater, onApply }: Props) {
  const t = useTranslations("dashboard");

  return (
    <ActionBar.Root
      open={count > 0}
      onOpenChange={(event) => {
        if (!event.open) onClear();
      }}
      closeOnInteractOutside={false}
    >
      <Portal>
        <ActionBar.Positioner>
          <ActionBar.Content data-selection-bar flexWrap="wrap">
            <ActionBar.SelectionTrigger data-selection-count>
              {t("selectionCount", { count })}
            </ActionBar.SelectionTrigger>
            <ActionBar.Separator />
            <Button size="sm" data-selection-water disabled={!connected} onClick={onWater}>
              {t("menu.water")}
            </Button>
            <Menu.Root lazyMount unmountOnExit onSelect={({ value }) => onApply(value)}>
              <Menu.Trigger asChild>
                <Button size="sm" variant="outline" data-selection-control disabled={!connected}>
                  {t("sectionControl")}
                </Button>
              </Menu.Trigger>
              <Portal>
                <Menu.Positioner>
                  <Menu.Content data-selection-control-items>{controlItems}</Menu.Content>
                </Menu.Positioner>
              </Portal>
            </Menu.Root>
            <Menu.Root lazyMount unmountOnExit onSelect={({ value }) => onApply(value)}>
              <Menu.Trigger asChild>
                <Button size="sm" variant="outline" data-selection-move disabled={!connected}>
                  {t("menu.moveLabel")}
                </Button>
              </Menu.Trigger>
              <Portal>
                <Menu.Positioner>
                  <Menu.Content data-selection-move-items>{moveItems}</Menu.Content>
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
  );
}
