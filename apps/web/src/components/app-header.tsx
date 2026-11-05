"use client";

import { Button, Flex, Heading, HStack, Link as ChakraLink, Menu, Portal } from "@chakra-ui/react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";

export function AppHeader({ title }: { title: string }) {
  const t = useTranslations("nav");
  const tDash = useTranslations("dashboard");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const isAdmin = session?.user.role === "admin";

  const signOut = async () => {
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
                  {isAdmin && (
                    <Menu.Item value="users" asChild>
                      <Link href="/users">{t("users")}</Link>
                    </Menu.Item>
                  )}
                  <Menu.Item value="sign-out" onClick={signOut}>
                    {t("signOut")}
                  </Menu.Item>
                </Menu.Content>
              </Menu.Positioner>
            </Portal>
          </Menu.Root>
        )}
      </HStack>
    </Flex>
  );
}
