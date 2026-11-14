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
  Image,
  Menu,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { canControl } from "@terranova/shared";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { type ReactNode, useEffect, useState } from "react";
import { LuChevronDown, LuLanguages, LuMenu, LuMoon, LuSun } from "react-icons/lu";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { ChangePasswordDialog } from "./change-password-dialog";
import { ScaleRule } from "./panel";
import { MAIN_ID } from "./skip-link";
import { chamfer } from "./theme";
import { toaster } from "./toaster";
import { usePush } from "./use-push";

export function Logo({ inverted = false }: { inverted?: boolean }) {
  return (
    <HStack gap="2.5">
      {/* The app icon (sprout and soil on white); the name beside it is the accessible text. */}
      <Image src="/app-icon.svg" alt="" boxSize="9" flexShrink={0} style={{ clipPath: chamfer("10px") }} />
      <Text fontSize="xl" fontWeight="800" letterSpacing="-0.02em" color={inverted ? "#f2f2f2" : "ink"}>
        TerraNova
      </Text>
    </HStack>
  );
}

/** The drawer stays dark in either theme, so its plain buttons need their own colours. */
const DRAWER_ACTION = {
  variant: "ghost",
  color: "#f2f2f2",
  justifyContent: "flex-start",
  w: "full",
  minH: "11",
  _hover: { bg: "whiteAlpha.200" },
  focusRingColor: "#f2f2f2",
} as const;

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

  const row = direction === "row";

  return (
    <Flex
      as="nav"
      direction={direction}
      gap={row ? "0" : "2"}
      bg={row ? "surface" : undefined}
      borderRadius={row ? "full" : undefined}
      aria-label={t("navigation")}
    >
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
              px={row ? "5" : undefined}
              borderRadius={row ? "full" : undefined}
              fontWeight="bold"
              textDecoration="none"
              bg={row && active ? "ink" : undefined}
              color={!row ? "#f2f2f2" : active ? "inkContrast" : "ink"}
              fontSize={row ? "sm" : "xl"}
              _hover={{ textDecoration: "underline" }}
              _focusVisible={{ outline: "2px solid", outlineColor: row ? "ink" : "currentColor", outlineOffset: "2px" }}
            >
              <Link href={item.href} aria-current={active ? "page" : undefined} onClick={onNavigate}>
                {!row && active && <Box boxSize="1.5" borderRadius="full" bg="currentColor" aria-hidden />}
                {item.label}
              </Link>
            </ChakraLink>
          );
        })}
    </Flex>
  );
}

/** Light or dark, with an icon only in the header or spelled out in the drawer. */
function ThemeToggle({ inDrawer = false }: { inDrawer?: boolean }) {
  const t = useTranslations("nav");
  const { resolvedTheme, setTheme } = useTheme();
  // The server can't know the visitor's theme, so the icon waits until the page is running.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  const label = t(dark ? "lightMode" : "darkMode");
  const toggle = () => setTheme(dark ? "light" : "dark");

  if (inDrawer) {
    return (
      <Button {...DRAWER_ACTION} onClick={toggle}>
        {dark ? <LuSun aria-hidden /> : <LuMoon aria-hidden />}
        {label}
      </Button>
    );
  }
  return (
    <IconButton variant="ghost" colorPalette="gray" aria-label={label} onClick={toggle}>
      {dark ? <LuSun /> : <LuMoon />}
    </IconButton>
  );
}

/**
 * The page frame: navigation across the top, or in a drawer on small screens, with the full width for content.
 * A page without a `title` puts its own h1 in its content.
 */
export function AppShell({ title, children }: { title?: string; children: ReactNode }) {
  const t = useTranslations("nav");
  const tRoles = useTranslations("roles");
  const tDash = useTranslations("dashboard");
  const otherLocale = useLocale() === "ko" ? "en" : "ko";
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
    <Box minH="100dvh" px={{ base: "3", md: "4" }} pb="8">
      <Flex as="header" align="center" justify="space-between" gap="4" py="3">
        {/* Equal sides keep the menu in the middle of the page, whatever the account name's length. */}
        <Box flex={{ lg: "1 1 0" }} minW="0">
          <Logo />
        </Box>
        <Box hideBelow="lg" flexShrink={0}>
          <NavLinks direction="row" />
        </Box>
        <HStack gap={{ base: "1", md: "2" }} flex={{ lg: "1 1 0" }} justify="flex-end" flexShrink={0}>
          {/* A phone's header only has room for the essentials; these two move to the drawer there. */}
          <HStack gap={{ base: "1", md: "2" }} hideBelow="sm">
            <Button asChild variant="ghost" colorPalette="gray" size="sm" minH="11">
              <Link href={pathname} locale={otherLocale}>
                <LuLanguages aria-hidden />
                {tDash("languageSwitch")}
              </Link>
            </Button>
            <ThemeToggle />
          </HStack>
          {session && (
            <Menu.Root>
              <Menu.Trigger asChild>
                <Button
                  bg="surface"
                  color="ink"
                  _hover={{ bg: "brand.subtle" }}
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
                  <Icon as={LuChevronDown} aria-hidden />
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

      <Box as="main" id={MAIN_ID} tabIndex={-1}>
        {title && (
          <Box mt={{ base: "4", md: "6" }} mb={{ base: "6", md: "8" }}>
            <Heading
              as="h1"
              fontSize={{ base: "3xl", md: "5xl" }}
              fontWeight="300"
              letterSpacing="-0.03em"
              lineHeight="1.1"
              mb="4"
            >
              {title}
            </Heading>
            <ScaleRule />
          </Box>
        )}
        {children}
      </Box>

      <Drawer.Root placement="end" open={drawerOpen} onOpenChange={(event) => setDrawerOpen(event.open)}>
        <Portal>
          <Drawer.Backdrop />
          <Drawer.Positioner>
            <Drawer.Content maxW="72" bg="#181818" color="#f2f2f2">
              <Drawer.Header>
                <Logo inverted />
              </Drawer.Header>
              <Drawer.Body>
                <Stack>
                  <NavLinks direction="column" onNavigate={() => setDrawerOpen(false)} />
                  <Stack hideFrom="sm" mt="4" pt="4" borderTopWidth="1px" borderColor="whiteAlpha.300" gap="1">
                    <Button asChild {...DRAWER_ACTION}>
                      <Link href={pathname} locale={otherLocale} onClick={() => setDrawerOpen(false)}>
                        <LuLanguages aria-hidden />
                        {tDash("languageSwitch")}
                      </Link>
                    </Button>
                    <ThemeToggle inDrawer />
                  </Stack>
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
