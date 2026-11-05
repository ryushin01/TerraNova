"use client";

import { Button, Dialog, Field, Fieldset, HStack, Input, Portal, Stack, Text } from "@chakra-ui/react";
import { type AutomationRules, type ControlResult, normalizeAutomation } from "@terranova/shared";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";

interface Props {
  section: { name: string; rules: AutomationRules } | null;
  onClose: () => void;
  onSave: (rules: AutomationRules) => Promise<ControlResult>;
}

const numberOrNull = (text: string) => (text.trim() === "" ? null : Number(text));

const textOrNull = (text: string) => text.trim() || null;

const toText = (value: number | string | null | undefined) => (value == null ? "" : String(value));

export function AutomationDialog({ section, onClose, onSave }: Props) {
  // Kept outside the form, which remounts on close, so reopening can't send a second save alongside one still running.
  const [saving, setSaving] = useState(false);
  const save: Props["onSave"] = async (rules) => {
    setSaving(true);
    try {
      return await onSave(rules);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root
      open={!!section}
      onOpenChange={(event) => {
        if (!event.open) onClose();
      }}
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content mx="4">
            {/* Remounts per section, so the fields start from that section's rules. */}
            <AutomationForm key={section?.name} section={section} onClose={onClose} onSave={save} saving={saving} />
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

function AutomationForm({ section, onClose, onSave, saving }: Props & { saving: boolean }) {
  const t = useTranslations("automation");
  const rules = section?.rules;
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    defaultValues: {
      "vent-on": toText(rules?.ventOnAboveC),
      "vent-off": toText(rules?.ventOffBelowC),
      "humidity-on": toText(rules?.ventOnAboveHumidityPct),
      "humidity-off": toText(rules?.ventOffBelowHumidityPct),
      "light-on": toText(rules?.lightOnAt),
      "light-off": toText(rules?.lightOffAt),
      "soil-alarm": toText(rules?.soilAlarmBelowPct),
    },
  });
  const error = errors.root?.server?.message;

  const submit = handleSubmit(async (values) => {
    const next = normalizeAutomation({
      ventOnAboveC: numberOrNull(values["vent-on"]),
      ventOffBelowC: numberOrNull(values["vent-off"]),
      ventOnAboveHumidityPct: numberOrNull(values["humidity-on"]),
      ventOffBelowHumidityPct: numberOrNull(values["humidity-off"]),
      lightOnAt: textOrNull(values["light-on"]),
      lightOffAt: textOrNull(values["light-off"]),
      soilAlarmBelowPct: numberOrNull(values["soil-alarm"]),
    });
    if (!next) {
      setError("root.server", { message: t("invalid") });
      return;
    }
    const result = await onSave(next);
    if (result.ok) onClose();
    else setError("root.server", { message: t("failed") });
  });

  return (
    <form onSubmit={submit}>
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
                <Input {...register("vent-on")} type="number" step="0.5" min={-20} max={60} />
              </Field.Root>
              <Field.Root>
                <Field.Label>{t("ventOff")}</Field.Label>
                <Input {...register("vent-off")} type="number" step="0.5" min={-20} max={60} />
              </Field.Root>
            </HStack>
            <HStack align="flex-start">
              <Field.Root>
                <Field.Label>{t("humidityOn")}</Field.Label>
                <Input {...register("humidity-on")} type="number" step="1" min={0} max={100} />
              </Field.Root>
              <Field.Root>
                <Field.Label>{t("humidityOff")}</Field.Label>
                <Input {...register("humidity-off")} type="number" step="1" min={0} max={100} />
              </Field.Root>
            </HStack>
            <Field.Root>
              <Field.HelperText>{t("ventHelp")}</Field.HelperText>
            </Field.Root>
          </Fieldset.Root>
          <Fieldset.Root>
            <Fieldset.Legend>{t("light")}</Fieldset.Legend>
            <HStack align="flex-start">
              <Field.Root>
                <Field.Label>{t("lightOn")}</Field.Label>
                <Input {...register("light-on")} type="time" />
              </Field.Root>
              <Field.Root>
                <Field.Label>{t("lightOff")}</Field.Label>
                <Input {...register("light-off")} type="time" />
              </Field.Root>
            </HStack>
          </Fieldset.Root>
          <Field.Root invalid={!!error}>
            <Field.Label>{t("soil")}</Field.Label>
            <Input {...register("soil-alarm")} type="number" step="1" min={1} max={69} />
            <Field.HelperText>{t("soilHelp")}</Field.HelperText>
            {error && <Field.ErrorText data-automation-error>{error}</Field.ErrorText>}
          </Field.Root>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button type="submit" data-automation-save loading={saving}>
          {t("save")}
        </Button>
      </Dialog.Footer>
    </form>
  );
}
