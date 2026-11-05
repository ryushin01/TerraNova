"use client";

import { Button, Center, Dialog, Field, Grid, Icon, IconButton, Input, Portal, Stack, Text } from "@chakra-ui/react";
import { CROP_ICON_KEYS, suggestCropIcon, type AddCropResult, type CropIconKey } from "@terranova/shared";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { CROP_ICONS } from "./crops";

const MAX_NAME_LENGTH = 30;

interface Props {
  open: boolean;
  onClose: () => void;
  onAdd: (name: string, icon: CropIconKey) => Promise<AddCropResult>;
}

export function AddCropDialog({ open, onClose, onAdd }: Props) {
  const t = useTranslations("addCrop");
  const [name, setName] = useState("");
  /** Null means the icon follows the name. It stops once someone picks one by hand. */
  const [chosenIcon, setChosenIcon] = useState<CropIconKey | null>(null);
  const [error, setError] = useState<"duplicate" | "other" | null>(null);
  const [saving, setSaving] = useState(false);

  const icon = chosenIcon ?? suggestCropIcon(name);
  const trimmed = name.trim();

  const close = () => {
    setName("");
    setChosenIcon(null);
    setError(null);
    onClose();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    const result = await onAdd(trimmed, icon);
    setSaving(false);
    if (result.ok) close();
    else setError(result.error === "duplicate" ? "duplicate" : "other");
  };

  return (
    <Dialog.Root
      open={open}
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
                <Dialog.Title>{t("title")}</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                <Stack gap="4">
                  <Center flexDirection="column" gap="1" py="3" bg="bg.muted" borderRadius="md">
                    <Icon as={CROP_ICONS[icon]} boxSize="12" data-preview-icon={icon} aria-hidden />
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
                      name="crop-name"
                      autoFocus
                      autoComplete="off"
                      size="lg"
                      maxLength={MAX_NAME_LENGTH}
                      placeholder={t("namePlaceholder")}
                      value={name}
                      onChange={(event) => {
                        setName(event.currentTarget.value);
                        setError(null);
                      }}
                    />
                    {error && <Field.ErrorText>{t(error === "duplicate" ? "duplicate" : "failed")}</Field.ErrorText>}
                  </Field.Root>

                  <Stack gap="1.5">
                    <Text textStyle="sm" fontWeight="medium">
                      {t("iconLabel")}
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
                      {CROP_ICON_KEYS.map((key) => (
                        <IconButton
                          key={key}
                          type="button"
                          size="md"
                          data-icon-option={key}
                          aria-label={key}
                          aria-pressed={icon === key}
                          variant={icon === key ? "solid" : "ghost"}
                          onClick={() => setChosenIcon(key)}
                        >
                          <Icon as={CROP_ICONS[key]} />
                        </IconButton>
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
                  {t("add")}
                </Button>
              </Dialog.Footer>
            </form>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
