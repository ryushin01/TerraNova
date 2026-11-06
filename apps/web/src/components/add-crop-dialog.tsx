"use client";

import { Button, Center, Dialog, Field, Grid, IconButton, Input, Portal, Stack, Text, Tooltip } from "@chakra-ui/react";
import { type AddCropResult, type CropIconKey, suggestCropIcon } from "@terranova/shared";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { CROP_ICON_CHOICES, CropIcon } from "./crops";

const MAX_NAME_LENGTH = 30;

interface Props {
  open: boolean;
  /** The crop being edited. Without one, this adds a new crop. */
  editing?: { name: string; icon: CropIconKey } | null;
  onClose: () => void;
  onSubmit: (name: string, icon: CropIconKey) => Promise<AddCropResult>;
}

export function AddCropDialog({ open, editing, onClose, onSubmit }: Props) {
  const t = useTranslations("addCrop");
  const tIcons = useTranslations("cropIcons");
  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors },
  } = useForm({ defaultValues: { name: "" } });
  const name = watch("name");
  // Kept outside the form: reopening resets the form, but must not let a second save start alongside one still running.
  const [saving, setSaving] = useState(false);
  /** Null means the icon follows the name. It stops once someone picks one by hand. */
  const [chosenIcon, setChosenIcon] = useState<CropIconKey | null>(null);
  const error = errors.name?.message;
  const openTooltip = useRef<CropIconKey | null>(null);

  // An edit starts from the crop's icon, so renaming doesn't swap it behind someone's back.
  useEffect(() => {
    // A tooltip open as the dialog closes goes away without reporting it.
    openTooltip.current = null;
    if (!open) return;
    reset({ name: editing?.name ?? "" });
    setChosenIcon(editing?.icon ?? null);
  }, [open, editing, reset]);

  const icon = chosenIcon ?? suggestCropIcon(name);
  const trimmed = name.trim();

  const close = () => {
    reset({ name: "" });
    setChosenIcon(null);
    onClose();
  };

  const submit = handleSubmit(async () => {
    if (!trimmed) return;
    setSaving(true);
    const result = await onSubmit(trimmed, icon).finally(() => setSaving(false));
    if (result.ok) close();
    else setError("name", { message: t(result.error === "duplicate" ? "duplicate" : "failed") });
  });

  return (
    <Dialog.Root
      open={open}
      // Escape closes an open tooltip first, so it can't throw away what was typed.
      onEscapeKeyDown={(event) => {
        if (openTooltip.current) event.preventDefault();
      }}
      onOpenChange={(event) => {
        if (!event.open) close();
      }}
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content mx="4">
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{t(editing ? "editTitle" : "title")}</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                <Stack gap="4">
                  <Center flexDirection="column" gap="1" py="3" bg="bg.muted" borderRadius="md">
                    <CropIcon icon={icon} boxSize="14" data-preview-icon={icon} />
                    <Text fontWeight="medium" data-preview-name>
                      {trimmed || t("namePlaceholder")}
                    </Text>
                    <Text textStyle="xs" color="fg.muted">
                      {chosenIcon ? t("iconChosen") : t("iconAuto")}
                    </Text>
                  </Center>

                  <Field.Root required invalid={!!error}>
                    <Field.Label>{t("name")}</Field.Label>
                    <Input
                      {...register("name")}
                      autoFocus
                      autoComplete="off"
                      size="lg"
                      maxLength={MAX_NAME_LENGTH}
                      placeholder={t("namePlaceholder")}
                    />
                    {error && <Field.ErrorText>{error}</Field.ErrorText>}
                  </Field.Root>

                  <Stack gap="1.5">
                    <Text textStyle="sm" fontWeight="medium">
                      {t("iconLabel")}
                      {/* Tooltips don't reach touch screens, so the chosen one is named here too. */}
                      <Text as="span" color="fg.muted" fontWeight="normal" data-chosen-icon-name>
                        {" · "}
                        {tIcons(icon)}
                      </Text>
                    </Text>
                    <Grid
                      templateColumns="repeat(auto-fill, minmax(2.75rem, 1fr))"
                      gap="1"
                      maxH="36"
                      overflowY="auto"
                      p="1"
                      borderWidth="1px"
                      borderRadius="md"
                    >
                      {CROP_ICON_CHOICES.map((key) => (
                        <Tooltip.Root
                          key={key}
                          openDelay={200}
                          closeDelay={150}
                          interactive
                          lazyMount
                          unmountOnExit
                          onOpenChange={(event) => {
                            if (event.open) openTooltip.current = key;
                            else if (openTooltip.current === key) openTooltip.current = null;
                          }}
                        >
                          <Tooltip.Trigger asChild>
                            <IconButton
                              type="button"
                              size="md"
                              data-icon-option={key}
                              aria-label={tIcons(key)}
                              aria-pressed={icon === key}
                              variant={icon === key ? "subtle" : "ghost"}
                              onClick={() => setChosenIcon(key)}
                            >
                              <CropIcon icon={key} boxSize="7" />
                            </IconButton>
                          </Tooltip.Trigger>
                          {/* In a portal, because the scrolling grid would clip it. */}
                          <Portal>
                            <Tooltip.Positioner>
                              <Tooltip.Content>{tIcons(key)}</Tooltip.Content>
                            </Tooltip.Positioner>
                          </Portal>
                        </Tooltip.Root>
                      ))}
                    </Grid>
                  </Stack>
                </Stack>
              </Dialog.Body>
              <Dialog.Footer>
                <Button type="button" variant="outline" onClick={close}>
                  {t("cancel")}
                </Button>
                <Button type="submit" data-add-crop-submit loading={saving} disabled={!trimmed}>
                  {t(editing ? "save" : "add")}
                </Button>
              </Dialog.Footer>
            </form>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
