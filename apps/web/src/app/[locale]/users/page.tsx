import { Container } from "@chakra-ui/react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader } from "@/components/app-header";
import { UsersAdmin } from "@/components/users-admin";

export default async function UsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("users");

  return (
    <Container maxW="4xl" px={{ base: "4", md: "6" }} py={{ base: "4", md: "8" }}>
      <AppHeader title={t("title")} />
      <UsersAdmin />
    </Container>
  );
}
