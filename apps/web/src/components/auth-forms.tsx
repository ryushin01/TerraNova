"use client";

import { Alert, Box, Button, Field, Flex, Grid, Heading, Input, Stack, Text } from "@chakra-ui/react";
import type { CropIconKey } from "@terranova/shared";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { Logo } from "./app-shell";
import { CropIcon } from "./crops";
import { MAIN_ID } from "./skip-link";

const HERO_CROPS: CropIconKey[] = ["tomato", "corn", "flower", "wheat", "carrot", "leaf"];

function AuthCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const t = useTranslations("auth");
  return (
    <Flex minH="100dvh" direction={{ base: "column", lg: "row" }}>
      <Flex
        hideBelow="lg"
        flex="1.2"
        direction="column"
        justify="space-between"
        p="8"
        position="relative"
        overflow="hidden"
      >
        <Logo />
        {/* A thin cut-corner frame around the crops: decoration only. */}
        <Box position="absolute" top="14%" right="6%" w="62%" h="56%" aria-hidden>
          <Box
            as="svg"
            w="full"
            h="full"
            {...{ viewBox: "0 0 100 100", preserveAspectRatio: "none" }}
            overflow="visible"
          >
            <path
              d="M0 0 H72 L100 28 V100 H26 L0 76 Z"
              fill="none"
              stroke="var(--chakra-colors-ink)"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </Box>
          <Grid position="absolute" inset="0" placeItems="center" p="10%">
            <Grid templateColumns="repeat(3, 1fr)" gap="6">
              {HERO_CROPS.map((crop) => (
                <CropIcon key={crop} icon={crop} boxSize={{ lg: "16", xl: "20" }} />
              ))}
            </Grid>
          </Grid>
        </Box>
        <Stack gap="4" maxW="lg" position="relative">
          <Heading
            as="p"
            fontSize={{ lg: "4xl", xl: "5xl" }}
            fontWeight="800"
            letterSpacing="-0.025em"
            lineHeight="1.12"
          >
            {t("heroTitle")}
          </Heading>
          <Text fontWeight="bold">{t("heroBody")}</Text>
        </Stack>
      </Flex>
      <Flex
        as="main"
        id={MAIN_ID}
        tabIndex={-1}
        flex="1"
        align="center"
        justify="center"
        px="4"
        py="8"
        bg={{ lg: "surface" }}
      >
        <Box w="full" maxW="sm">
          <Box mb="8" hideFrom="lg">
            <Logo />
          </Box>
          <Heading as="h1" fontSize="3xl" fontWeight="800" letterSpacing="-0.02em">
            {title}
          </Heading>
          {description && (
            <Text color="fg.muted" mt="2">
              {description}
            </Text>
          )}
          <Box mt="6">{children}</Box>
        </Box>
      </Flex>
    </Flex>
  );
}

/**
 * Until the page is interactive, a submit would be a native browser request. Blocking the button
 * stops that, and method="post" keeps a password out of the URL if it ever happens anyway.
 */
function useInteractive() {
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  return interactive;
}

export function LoginForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: { email: "", password: "" } });
  const interactive = useInteractive();
  const error = errors.root?.server?.message;

  useEffect(() => {
    fetch("/api/setup")
      .then((response) => response.json())
      .then((status) => {
        if (status.needsSetup) router.replace("/setup");
      })
      .catch(() => setError("root.server", { message: t("requestFailed") }));
  }, [router, setError, t]);

  const submit = handleSubmit(async ({ email, password }) => {
    const result = await authClient.signIn.email({ email, password });
    if (result.error) setError("root.server", { message: t("loginFailed") });
    else router.replace("/");
  });

  return (
    <AuthCard title={t("loginTitle")}>
      <form method="post" onSubmit={submit}>
        <Stack gap="4">
          {error && (
            <Alert.Root status="error">
              <Alert.Indicator />
              <Alert.Title>{error}</Alert.Title>
            </Alert.Root>
          )}
          <Field.Root required>
            <Field.Label>{t("email")}</Field.Label>
            <Input {...register("email")} type="email" autoComplete="email" size="lg" />
          </Field.Root>
          <Field.Root required>
            <Field.Label>{t("password")}</Field.Label>
            <Input {...register("password")} type="password" autoComplete="current-password" size="lg" />
          </Field.Root>
          <Button type="submit" size="lg" loading={isSubmitting} disabled={!interactive}>
            {t("login")}
          </Button>
        </Stack>
      </form>
    </AuthCard>
  );
}

export function SetupForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: { name: "", email: "", password: "" } });
  const interactive = useInteractive();
  const error = errors.root?.server?.message;

  const submit = handleSubmit(async ({ name, email, password }) => {
    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      if (response.status === 409) {
        router.replace("/login");
      } else if (!response.ok) {
        setError("root.server", { message: t("setupFailed") });
      } else {
        const result = await authClient.signIn.email({ email, password });
        router.replace(result.error ? "/login" : "/");
      }
    } catch {
      setError("root.server", { message: t("requestFailed") });
    }
  });

  return (
    <AuthCard title={t("setupTitle")} description={t("setupDescription")}>
      <form method="post" onSubmit={submit}>
        <Stack gap="4">
          {error && (
            <Alert.Root status="error">
              <Alert.Indicator />
              <Alert.Title>{error}</Alert.Title>
            </Alert.Root>
          )}
          <Field.Root required>
            <Field.Label>{t("name")}</Field.Label>
            <Input {...register("name")} autoComplete="name" size="lg" />
          </Field.Root>
          <Field.Root required>
            <Field.Label>{t("email")}</Field.Label>
            <Input {...register("email")} type="email" autoComplete="email" size="lg" />
          </Field.Root>
          <Field.Root required>
            <Field.Label>{t("password")}</Field.Label>
            <Input {...register("password")} type="password" autoComplete="new-password" minLength={8} size="lg" />
            <Field.HelperText>
              <Text as="span">{t("passwordHelp")}</Text>
            </Field.HelperText>
          </Field.Root>
          <Button type="submit" size="lg" loading={isSubmitting} disabled={!interactive}>
            {t("createAdmin")}
          </Button>
        </Stack>
      </form>
    </AuthCard>
  );
}
