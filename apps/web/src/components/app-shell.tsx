"use client";

import {
  Avatar,
  Badge,
  Box,
  Button,
  Link as ChakraLink,
  CloseButton,
  Drawer,
  Flex,
  Heading,
  HStack,
  Icon,
  IconButton,
  Menu,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { canControl } from "@terranova/shared";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { LuChevronDown, LuLanguages, LuMenu, LuSprout } from "react-icons/lu";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { ChangePasswordDialog } from "./change-password-dialog";
import { chamfer } from "./theme";
import { toaster } from "./toaster";
import { usePush } from "./use-push";

export function Logo({ inverted = false }: { inverted?: boolean }) {
  return (
    <HStack gap="2.5">
      <Flex
        boxSize="9"
        align="center"
        justify="center"
        bg={inverted ? "white" : "ink"}
        color={inverted ? "ink" : "white"}
        style={{ clipPath: chamfer("10px") }}
      >
        <Icon as={LuSprout} boxSize="5" aria-hidden />
      </Flex>
      <Text fontSize="xl" fontWeight="800" letterSpacing="-0.02em" color={inverted ? "white" : "ink"}>
        TerraNova
      </Text>
    </HStack>
  );
}

function NavLinks({ direction, onNavigate }: { direction: "row" | "column"; onNavigate?: () => void }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const { data: session } = authClient.useSession();
  const role = session?.user.role;

  const items = [
    { href: "/", label: t("dashboard"), show: true },
    { href: "/sensors", label: t("sensors"), show: true },
    { href: "/history", label: t("history"), show: canControl(role) },
    { href: "/users", label: t("users"), show: role === "admin" },
  ];

  return (
    <Flex as="nav" direction={direction} gap={direction === "row" ? "8" : "2"} aria-label={t("navigation")}>
      {items
        .filter((item) => item.show)
        .map((item) => {
          const active = pathname === item.href;
          return (
            <ChakraLink
              asChild
              key={item.href}
              display="inline-flex"
              alignItems="center"
              gap="2"
              minH="11"
              fontWeight="bold"
              textDecoration="none"
              color={direction === "column" ? "white" : "ink"}
              fontSize={direction === "column" ? "xl" : "sm"}
              _hover={{ color: "copper", textDecoration: "none" }}
              _focusVisible={{ outline: "2px solid", outlineColor: "copper", outlineOffset: "2px" }}
            >
              <Link href={item.href} aria-current={active ? "page" : undefined} onClick={onNavigate}>
                {active && <Box boxSize="1.5" borderRadius="full" bg="copper" aria-hidden />}
                {item.label}
              </Link>
            </ChakraLink>
          );
        })}
    </Flex>
  );
}

/** The page frame: navigation across the top, or in a drawer on small screens, with the full width for content. */
export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  const t = useTranslations("nav");
  const tRoles = useTranslations("roles");
  const tDash = useTranslations("dashboard");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const [changingPassword, setChangingPassword] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const push = usePush();

  const togglePush = async () => {
    if (push.enabled) {
      await push.disable();
      toaster.create({ type: "info", title: t("notificationsDisabled") });
      return;
    }
    const outcome = await push.enable();
    if (outcome === "ok") toaster.create({ type: "success", title: t("notificationsEnabled") });
    else
      toaster.create({
        type: "error",
        title: t(outcome === "denied" ? "notificationsDenied" : "notificationsUnavailable"),
      });
  };

  const signOut = async () => {
    // Alarms shouldn't keep arriving on a browser after its user has signed out.
    if (push.enabled) await push.disable();
    await authClient.signOut();
    router.replace("/login");
  };

  const role = session?.user.role;

  return (
    <Box minH="100dvh" px={{ base: "4", md: "8" }} pb="12">
      <Flex as="header" align="center" justify="space-between" gap="4" py={{ base: "3", md: "5" }}>
        <Logo />
        <HStack gap={{ base: "1", md: "6" }} flexShrink={0}>
          <Box hideBelow="lg">
            <NavLinks direction="row" />
          </Box>
          <Button asChild variant="ghost" colorPalette="gray" size="sm" minH="11">
            <Link href={pathname} locale={locale === "ko" ? "en" : "ko"}>
              <LuLanguages aria-hidden />
              {tDash("languageSwitch")}
            </Link>
          </Button>
          {session && (
            <Menu.Root>
              <Menu.Trigger asChild>
                <Button
                  bg="white"
                  color="ink"
                  _hover={{ bg: "white", color: "copper" }}
                  size="sm"
                  minH="11"
                  pl="2"
                  pr="3"
                  aria-label={t("menu")}
                  maxW="48"
                >
                  <Avatar.Root size="2xs" variant="solid">
                    <Avatar.Fallback name={session.user.name} />
                  </Avatar.Root>
                  <Text hideBelow="sm" truncate>
                    {session.user.name}
                  </Text>
                  <Icon as={LuChevronDown} color="copper" aria-hidden />
                </Button>
              </Menu.Trigger>
              <Portal>
                <Menu.Positioner>
                  <Menu.Content>
                    <Box px="2" py="1.5">
                      <Text textStyle="sm" fontWeight="bold">
                        {session.user.name}
                      </Text>
                      {role && (
                        <Badge mt="1" size="sm">
                          {tRoles(role as "admin")}
                        </Badge>
                      )}
                    </Box>
                    <Menu.Separator />
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
          <IconButton
            hideFrom="lg"
            variant="ghost"
            colorPalette="gray"
            aria-label={t("openNavigation")}
            onClick={() => setDrawerOpen(true)}
          >
            <LuMenu />
          </IconButton>
        </HStack>
      </Flex>

      <Box as="main">
        <Heading
          as="h1"
          fontSize={{ base: "3xl", md: "5xl" }}
          fontWeight="800"
          letterSpacing="-0.025em"
          lineHeight="1.1"
          mt={{ base: "4", md: "8" }}
          mb={{ base: "6", md: "10" }}
        >
          {title}
        </Heading>
        {children}
      </Box>

      <Drawer.Root placement="end" open={drawerOpen} onOpenChange={(event) => setDrawerOpen(event.open)}>
        <Portal>
          <Drawer.Backdrop />
          <Drawer.Positioner>
            <Drawer.Content maxW="72" bg="ink" color="white">
              <Drawer.Header>
                <Logo inverted />
              </Drawer.Header>
              <Drawer.Body>
                <Stack>
                  <NavLinks direction="column" onNavigate={() => setDrawerOpen(false)} />
                </Stack>
              </Drawer.Body>
              <Drawer.CloseTrigger asChild>
                <CloseButton color="white" _hover={{ bg: "whiteAlpha.200" }} aria-label={t("closeNavigation")} />
              </Drawer.CloseTrigger>
            </Drawer.Content>
          </Drawer.Positioner>
        </Portal>
      </Drawer.Root>

      <ChangePasswordDialog open={changingPassword} onClose={() => setChangingPassword(false)} />
    </Box>
  );
}
