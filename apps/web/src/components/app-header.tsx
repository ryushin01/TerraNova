"use client";

import { Button, Flex, Heading, HStack, Link as ChakraLink, Menu, Portal } from "@chakra-ui/react";
import { canControl } from "@terranova/shared";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { ChangePasswordDialog } from "./change-password-dialog";
import { toaster } from "./toaster";
import { usePush } from "./use-push";

export function AppHeader({ title }: { title: string }) {
  const t = useTranslations("nav");
  const tDash = useTranslations("dashboard");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const isAdmin = session?.user.role === "admin";
  const [changingPassword, setChangingPassword] = useState(false);

  const push = usePush();

  const togglePush = async () => {
    if (push.enabled) {
      await push.disable();
      toaster.create({ type: "info", title: t("notificationsDisabled") });
      return;
    }
    const outcome = await push.enable();
    if (outcome === "ok") toaster.create({ type: "success", title: t("notificationsEnabled") });
    else toaster.create({ type: "error", title: t(outcome === "denied" ? "notificationsDenied" : "notificationsUnavailable") });
  };

  const signOut = async () => {
    // Alarms shouldn't keep arriving on a browser after its user has signed out.
    if (push.enabled) await push.disable();
    await authClient.signOut();
    router.replace("/login");
  };

  return (
    <Flex align="center" justify="space-between" gap="4" mb="6">
      <Heading as="h1" size={{ base: "xl", md: "2xl" }}>
        {title}
      </Heading>
      <HStack gap="3">
        <ChakraLink asChild minH="11" alignItems="center" display="inline-flex">
          <Link href={pathname} locale={locale === "ko" ? "en" : "ko"}>
            {tDash("languageSwitch")}
          </Link>
        </ChakraLink>
        {session && (
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button variant="outline" size="md" aria-label={t("menu")} maxW="40">
                {session.user.name}
              </Button>
            </Menu.Trigger>
            <Portal>
              <Menu.Positioner>
                <Menu.Content>
                  <Menu.Item value="dashboard" asChild>
                    <Link href="/">{t("dashboard")}</Link>
                  </Menu.Item>
                  <Menu.Item value="sensors" asChild>
                    <Link href="/sensors">{t("sensors")}</Link>
                  </Menu.Item>
                  {canControl(session.user.role) && (
                    <Menu.Item value="history" asChild>
                      <Link href="/history">{t("history")}</Link>
                    </Menu.Item>
                  )}
                  {isAdmin && (
                    <Menu.Item value="users" asChild>
                      <Link href="/users">{t("users")}</Link>
                    </Menu.Item>
                  )}
                  {push.supported && (
                    <Menu.Item value="notifications" onClick={togglePush}>
                      {t(push.enabled ? "notificationsOff" : "notificationsOn")}
                    </Menu.Item>
                  )}
                  <Menu.Item value="password" onClick={() => setChangingPassword(true)}>
                    {t("changePassword")}
                  </Menu.Item>
                  <Menu.Item value="sign-out" onClick={signOut}>
                    {t("signOut")}
                  </Menu.Item>
                </Menu.Content>
              </Menu.Positioner>
            </Portal>
          </Menu.Root>
        )}
      </HStack>
      <ChangePasswordDialog open={changingPassword} onClose={() => setChangingPassword(false)} />
    </Flex>
  );
}
