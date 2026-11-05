"use client";

import { Alert, Button, Card, Container, Field, Input, Stack, Text } from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";

function AuthCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Container maxW="sm" px="4" py={{ base: "8", md: "16" }}>
      <Card.Root>
        <Card.Header>
          <Card.Title>{title}</Card.Title>
          {description && <Card.Description>{description}</Card.Description>}
        </Card.Header>
        <Card.Body>{children}</Card.Body>
      </Card.Root>
    </Container>
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

const formValues = (event: FormEvent<HTMLFormElement>) =>
  Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;

export function LoginForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const interactive = useInteractive();

  useEffect(() => {
    fetch("/api/setup")
      .then((response) => response.json())
      .then((status) => {
        if (status.needsSetup) router.replace("/setup");
      })
      .catch(() => setError(t("requestFailed")));
  }, [router, t]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const { email = "", password = "" } = formValues(event);
    setLoading(true);
    setError(null);
    const result = await authClient.signIn.email({ email, password });
    setLoading(false);
    if (result.error) setError(t("loginFailed"));
    else router.replace("/");
  };

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
            <Input name="email" type="email" autoComplete="email" size="lg" />
          </Field.Root>
          <Field.Root required>
            <Field.Label>{t("password")}</Field.Label>
            <Input name="password" type="password" autoComplete="current-password" size="lg" />
          </Field.Root>
          <Button type="submit" size="lg" loading={loading} disabled={!interactive}>
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const interactive = useInteractive();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const { name, email = "", password = "" } = formValues(event);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      if (response.status === 409) {
        router.replace("/login");
      } else if (!response.ok) {
        setError(t("setupFailed"));
      } else {
        const result = await authClient.signIn.email({ email, password });
        router.replace(result.error ? "/login" : "/");
      }
    } catch {
      setError(t("requestFailed"));
    }
    setLoading(false);
  };

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
            <Input name="name" autoComplete="name" size="lg" />
          </Field.Root>
          <Field.Root required>
            <Field.Label>{t("email")}</Field.Label>
            <Input name="email" type="email" autoComplete="email" size="lg" />
          </Field.Root>
          <Field.Root required>
            <Field.Label>{t("password")}</Field.Label>
            <Input name="password" type="password" autoComplete="new-password" minLength={8} size="lg" />
            <Field.HelperText>
              <Text as="span">{t("passwordHelp")}</Text>
            </Field.HelperText>
          </Field.Root>
          <Button type="submit" size="lg" loading={loading} disabled={!interactive}>
            {t("createAdmin")}
          </Button>
        </Stack>
      </form>
    </AuthCard>
  );
}
