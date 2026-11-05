"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  Field,
  HStack,
  Input,
  NativeSelect,
  Portal,
  SimpleGrid,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { ROLE_NAMES, type RoleName } from "@terranova/shared";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { authClient } from "@/lib/auth-client";
import { toaster } from "./toaster";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role?: string | null;
}

function RoleSelect({
  value,
  onChange,
  name,
  label,
  disabled,
}: {
  value?: string;
  onChange?: (role: RoleName) => void;
  name?: string;
  label?: string;
  disabled?: boolean;
}) {
  const tRoles = useTranslations("roles");
  return (
    <NativeSelect.Root size="sm" disabled={disabled} minW="28">
      <NativeSelect.Field
        name={name}
        aria-label={label}
        value={value}
        defaultValue={value === undefined ? "viewer" : undefined}
        onChange={onChange ? (event) => onChange(event.currentTarget.value as RoleName) : undefined}
      >
        {ROLE_NAMES.map((role) => (
          <option key={role} value={role}>
            {tRoles(role)}
          </option>
        ))}
      </NativeSelect.Field>
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  );
}

export function UsersAdmin() {
  const t = useTranslations("users");
  const tAuth = useTranslations("auth");
  const tRoles = useTranslations("roles");
  const { data: session, isPending } = authClient.useSession();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const createForm = useForm({
    defaultValues: { name: "", email: "", password: "", role: "viewer" as RoleName },
  });
  const [removing, setRemoving] = useState<UserRow | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const resetForm = useForm({ defaultValues: { "new-password": "" } });
  // Kept outside the form: closing clears the form, but must not let a second reset start alongside one still running.
  const [resetBusy, setResetBusy] = useState(false);
  const isAdmin = session?.user.role === "admin";

  const load = useCallback(async () => {
    const result = await authClient.admin.listUsers({ query: { limit: 100, sortBy: "createdAt" } });
    if (result.data) setUsers(result.data.users as UserRow[]);
    else toaster.create({ type: "error", title: t("failed") });
  }, [t]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  if (isPending) return <Spinner aria-label={t("loading")} />;
  if (!isAdmin) {
    return (
      <Alert.Root status="error">
        <Alert.Indicator />
        <Alert.Title>{t("forbidden")}</Alert.Title>
      </Alert.Root>
    );
  }

  const create = createForm.handleSubmit(async (values) => {
    const result = await authClient.admin.createUser(values);
    if (result.error) {
      toaster.create({ type: "error", title: t("createFailed") });
      return;
    }
    createForm.reset();
    toaster.create({ type: "success", title: t("created") });
    await load();
  });

  const changeRole = async (user: UserRow, role: RoleName) => {
    const result = await authClient.admin.setRole({ userId: user.id, role });
    toaster.create(result.error ? { type: "error", title: t("failed") } : { type: "success", title: t("updated") });
    await load();
  };

  // Clear on close, so a password never stays in the form state.
  const closeReset = () => {
    resetForm.reset();
    setResetting(null);
  };

  const resetPassword = resetForm.handleSubmit(async ({ "new-password": newPassword }) => {
    if (!resetting) return;
    setResetBusy(true);
    const result = await authClient.admin.setUserPassword({ userId: resetting.id, newPassword });
    // The old password may be why this was needed, so nobody keeps a sign-in made with it.
    const revoked = result.error ? null : await authClient.admin.revokeUserSessions({ userId: resetting.id });
    setResetBusy(false);
    if (result.error || revoked?.error) {
      toaster.create({ type: "error", title: t("resetFailed") });
      return;
    }
    toaster.create({ type: "success", title: t("resetDone") });
    closeReset();
  });

  const remove = async () => {
    if (!removing) return;
    const result = await authClient.admin.removeUser({ userId: removing.id });
    toaster.create(result.error ? { type: "error", title: t("failed") } : { type: "success", title: t("removed") });
    setRemoving(null);
    await load();
  };

  return (
    <Stack gap="6">
      <Card.Root>
        <Card.Header>
          <Card.Title>{t("add")}</Card.Title>
          <Card.Description>{t("roleHelp")}</Card.Description>
        </Card.Header>
        <Card.Body>
          <form onSubmit={create}>
            <Stack gap="4">
              <SimpleGrid columns={{ base: 1, md: 2 }} gap="4">
                <Field.Root required>
                  <Field.Label>{tAuth("name")}</Field.Label>
                  <Input {...createForm.register("name")} autoComplete="off" />
                </Field.Root>
                <Field.Root required>
                  <Field.Label>{tAuth("email")}</Field.Label>
                  <Input {...createForm.register("email")} type="email" autoComplete="off" />
                </Field.Root>
                <Field.Root required>
                  <Field.Label>{tAuth("password")}</Field.Label>
                  <Input
                    {...createForm.register("password")}
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                  />
                  <Field.HelperText>{tAuth("passwordHelp")}</Field.HelperText>
                </Field.Root>
                <Field.Root>
                  <Field.Label>{t("role")}</Field.Label>
                  <Controller
                    control={createForm.control}
                    name="role"
                    render={({ field }) => (
                      <RoleSelect name={field.name} value={field.value} onChange={field.onChange} />
                    )}
                  />
                </Field.Root>
              </SimpleGrid>
              <Button type="submit" alignSelf="flex-start" size="lg" loading={createForm.formState.isSubmitting}>
                {t("create")}
              </Button>
            </Stack>
          </form>
        </Card.Body>
      </Card.Root>

      {!users ? (
        <Spinner aria-label={t("loading")} />
      ) : (
        <Table.ScrollArea borderWidth="1px" borderRadius="md">
          <Table.Root size="sm">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>{tAuth("name")}</Table.ColumnHeader>
                <Table.ColumnHeader>{tAuth("email")}</Table.ColumnHeader>
                <Table.ColumnHeader>{t("role")}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t("actions")}</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {users.map((user) => {
                const isMe = user.id === session.user.id;
                return (
                  <Table.Row key={user.id} data-user={user.email}>
                    <Table.Cell>
                      <Text as="span" whiteSpace="nowrap">
                        {user.name}
                      </Text>{" "}
                      {isMe && <Badge>{t("me")}</Badge>}
                    </Table.Cell>
                    <Table.Cell>{user.email}</Table.Cell>
                    <Table.Cell>
                      {isMe ? (
                        tRoles((user.role ?? "viewer") as RoleName)
                      ) : (
                        <RoleSelect
                          label={t("role")}
                          value={user.role ?? "viewer"}
                          onChange={(role) => changeRole(user, role)}
                        />
                      )}
                    </Table.Cell>
                    <Table.Cell textAlign="end" whiteSpace="nowrap">
                      {!isMe && (
                        <HStack gap="2" justify="flex-end">
                          <Button size="sm" variant="outline" onClick={() => setResetting(user)}>
                            {t("resetPassword")}
                          </Button>
                          <Button size="sm" variant="outline" colorPalette="red" onClick={() => setRemoving(user)}>
                            {t("remove")}
                          </Button>
                        </HStack>
                      )}
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
        </Table.ScrollArea>
      )}

      <Dialog.Root
        open={!!resetting}
        onOpenChange={(event) => {
          if (!event.open) closeReset();
        }}
      >
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content mx="4">
              <form onSubmit={resetPassword}>
                <Dialog.Header>
                  <Dialog.Title>{t("resetTitle", { name: resetting?.name ?? "" })}</Dialog.Title>
                </Dialog.Header>
                <Dialog.Body>
                  <Field.Root required>
                    <Field.Label>{t("resetLabel")}</Field.Label>
                    <Input
                      {...resetForm.register("new-password")}
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      size="lg"
                    />
                    <Field.HelperText>{t("resetHelp")}</Field.HelperText>
                  </Field.Root>
                </Dialog.Body>
                <Dialog.Footer>
                  <Button type="button" variant="outline" onClick={closeReset}>
                    {t("cancel")}
                  </Button>
                  <Button type="submit" data-reset-password-submit loading={resetBusy}>
                    {t("resetSubmit")}
                  </Button>
                </Dialog.Footer>
              </form>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      <Dialog.Root
        role="alertdialog"
        open={!!removing}
        onOpenChange={(event) => {
          if (!event.open) setRemoving(null);
        }}
      >
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content mx="4">
              <Dialog.Header>
                <Dialog.Title>{t("confirmRemoveTitle")}</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>{t("confirmRemoveBody", { name: removing?.name ?? "" })}</Dialog.Body>
              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">{t("cancel")}</Button>
                </Dialog.ActionTrigger>
                <Button colorPalette="red" onClick={remove}>
                  {t("remove")}
                </Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </Stack>
  );
}
