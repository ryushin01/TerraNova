"use client";

import { Button, Dialog, Field, Input, Portal, Stack } from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { authClient } from "@/lib/auth-client";
import { toaster } from "./toaster";

export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("password");
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm({ defaultValues: { current: "", next: "", confirm: "" } });
  const error = errors.confirm?.message ?? errors.root?.server?.message;

  // Kept outside the form: closing clears the form, but must not let a second save start alongside one still running.
  const [saving, setSaving] = useState(false);

  // Clear on close, so a password never stays in the form state.
  const close = () => {
    reset();
    onClose();
  };

  const submit = handleSubmit(async ({ current, next }) => {
    setSaving(true);
    const result = await authClient
      .changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true })
      .finally(() => setSaving(false));
    if (result.error) {
      setError("root.server", {
        message: result.error.status === 429 ? t("tooMany") : t("changeFailed"),
      });
      return;
    }
    toaster.create({ type: "success", title: t("changed") });
    close();
  });

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
                <Dialog.Title>{t("changeTitle")}</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                <Stack gap="4">
                  <Field.Root required>
                    <Field.Label>{t("current")}</Field.Label>
                    <Input {...register("current")} type="password" autoComplete="current-password" size="lg" />
                  </Field.Root>
                  <Field.Root required>
                    <Field.Label>{t("new")}</Field.Label>
                    <Input {...register("next")} type="password" autoComplete="new-password" minLength={8} size="lg" />
                    <Field.HelperText>{t("help")}</Field.HelperText>
                  </Field.Root>
                  <Field.Root required invalid={!!error}>
                    <Field.Label>{t("confirm")}</Field.Label>
                    <Input
                      {...register("confirm", {
                        validate: (value, values) => value === values.next || t("mismatch"),
                      })}
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      size="lg"
                    />
                    {error && <Field.ErrorText>{error}</Field.ErrorText>}
                  </Field.Root>
                </Stack>
              </Dialog.Body>
              <Dialog.Footer>
                <Button type="button" variant="outline" onClick={close}>
                  {t("cancel")}
                </Button>
                <Button type="submit" data-change-password-submit loading={saving}>
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
