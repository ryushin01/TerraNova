"use client";

import { Button, Dialog, Field, HStack, Input, Portal, Stack, Tag, Text, Wrap } from "@chakra-ui/react";
import { type ControlResult, MAX_ALARM_TIMES, normalizeAlarmTimes } from "@terranova/shared";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

interface Props {
  /** The section being edited, or null when closed. */
  section: { name: string; times: string[] } | null;
  timeZone: string;
  onClose: () => void;
  onSave: (times: string[]) => Promise<ControlResult>;
}

export function AlarmTimesDialog({ section, timeZone, onClose, onSave }: Props) {
  const t = useTranslations("alarmTimes");
  const [times, setTimes] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setTimes(section?.times ?? []);
    setDraft("");
    setFailed(false);
  }, [section]);

  const add = () => {
    if (!draft) return;
    setTimes((current) => normalizeAlarmTimes([...current, draft]) ?? current);
    setDraft("");
  };

  const save = async () => {
    setSaving(true);
    setFailed(false);
    const result = await onSave(times);
    setSaving(false);
    if (result.ok) onClose();
    else setFailed(true);
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
          <Dialog.Content mx="4" data-alarm-times-dialog>
            <Dialog.Header>
              <Dialog.Title>{t("title", { section: section?.name ?? "" })}</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Stack gap="4">
                {times.length === 0 ? (
                  <Text textStyle="sm" color="fg.muted">
                    {t("none")}
                  </Text>
                ) : (
                  <Wrap gap="2">
                    {times.map((time) => (
                      <Tag.Root key={time} size="lg" data-alarm-time={time}>
                        <Tag.Label>{time}</Tag.Label>
                        <Tag.EndElement>
                          <Tag.CloseTrigger
                            aria-label={t("remove", { time })}
                            onClick={() => setTimes((current) => current.filter((item) => item !== time))}
                          />
                        </Tag.EndElement>
                      </Tag.Root>
                    ))}
                  </Wrap>
                )}

                <Field.Root invalid={failed}>
                  <Field.Label>{t("add")}</Field.Label>
                  <HStack w="full">
                    <Input
                      name="alarm-time"
                      type="time"
                      size="lg"
                      value={draft}
                      onChange={(event) => setDraft(event.currentTarget.value)}
                    />
                    <Button
                      variant="outline"
                      size="lg"
                      data-alarm-time-add
                      disabled={!draft || times.length >= MAX_ALARM_TIMES}
                      onClick={add}
                    >
                      {t("addButton")}
                    </Button>
                  </HStack>
                  <Field.HelperText>{t("help", { timeZone })}</Field.HelperText>
                  {failed && <Field.ErrorText>{t("failed")}</Field.ErrorText>}
                </Field.Root>
              </Stack>
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.ActionTrigger asChild>
                <Button variant="outline">{t("cancel")}</Button>
              </Dialog.ActionTrigger>
              <Button data-alarm-times-save loading={saving} onClick={save}>
                {t("save")}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
