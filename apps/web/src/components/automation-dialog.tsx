"use client";

import { Button, Dialog, Field, Fieldset, HStack, Input, Portal, Stack, Text } from "@chakra-ui/react";
import { normalizeAutomation, type AutomationRules, type ControlResult } from "@terranova/shared";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

interface Props {
  section: { name: string; rules: AutomationRules } | null;
  onClose: () => void;
  onSave: (rules: AutomationRules) => Promise<ControlResult>;
}

const numberOrNull = (value: FormDataEntryValue | null) => {
  const text = String(value ?? "").trim();
  return text === "" ? null : Number(text);
};

const textOrNull = (value: FormDataEntryValue | null) => String(value ?? "").trim() || null;

export function AutomationDialog({ section, onClose, onSave }: Props) {
  const t = useTranslations("automation");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const rules = section?.rules;

  const close = () => {
    setError(null);
    onClose();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = normalizeAutomation({
      ventOnAboveC: numberOrNull(data.get("vent-on")),
      ventOffBelowC: numberOrNull(data.get("vent-off")),
      lightOnAt: textOrNull(data.get("light-on")),
      lightOffAt: textOrNull(data.get("light-off")),
      soilAlarmBelowPct: numberOrNull(data.get("soil-alarm")),
    });
    if (!next) {
      setError(t("invalid"));
      return;
    }
    setSaving(true);
    const result = await onSave(next);
    setSaving(false);
    if (result.ok) close();
    else setError(t("failed"));
  };

  return (
    <Dialog.Root
      open={!!section}
      onOpenChange={(event) => {
        if (!event.open) close();
      }}
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content mx="4">
            {/* Remounts per section, so the fields start from that section's rules. */}
            <form key={section?.name} onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{t("title", { section: section?.name ?? "" })}</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                <Stack gap="5">
                  <Text textStyle="sm" color="fg.muted">
                    {t("help")}
                  </Text>
                  <Fieldset.Root>
                    <Fieldset.Legend>{t("vent")}</Fieldset.Legend>
                    <HStack align="flex-start">
                      <Field.Root>
                        <Field.Label>{t("ventOn")}</Field.Label>
                        <Input name="vent-on" type="number" step="0.5" min={-20} max={60} defaultValue={rules?.ventOnAboveC ?? ""} />
                      </Field.Root>
                      <Field.Root>
                        <Field.Label>{t("ventOff")}</Field.Label>
                        <Input name="vent-off" type="number" step="0.5" min={-20} max={60} defaultValue={rules?.ventOffBelowC ?? ""} />
                      </Field.Root>
                    </HStack>
                  </Fieldset.Root>
                  <Fieldset.Root>
                    <Fieldset.Legend>{t("light")}</Fieldset.Legend>
                    <HStack align="flex-start">
                      <Field.Root>
                        <Field.Label>{t("lightOn")}</Field.Label>
                        <Input name="light-on" type="time" defaultValue={rules?.lightOnAt ?? ""} />
                      </Field.Root>
                      <Field.Root>
                        <Field.Label>{t("lightOff")}</Field.Label>
                        <Input name="light-off" type="time" defaultValue={rules?.lightOffAt ?? ""} />
                      </Field.Root>
                    </HStack>
                  </Fieldset.Root>
                  <Field.Root invalid={!!error}>
                    <Field.Label>{t("soil")}</Field.Label>
                    <Input name="soil-alarm" type="number" step="1" min={1} max={69} defaultValue={rules?.soilAlarmBelowPct ?? ""} />
                    <Field.HelperText>{t("soilHelp")}</Field.HelperText>
                    {error && <Field.ErrorText data-automation-error>{error}</Field.ErrorText>}
                  </Field.Root>
                </Stack>
              </Dialog.Body>
              <Dialog.Footer>
                <Button type="button" variant="outline" onClick={close}>
                  {t("cancel")}
                </Button>
                <Button type="submit" data-automation-save loading={saving}>
                  {t("save")}
                </Button>
              </Dialog.Footer>
            </form>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
