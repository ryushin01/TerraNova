import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { UsersAdmin } from "@/components/users-admin";

export default async function UsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("users");

  return (
    <AppShell title={t("title")}>
      <UsersAdmin />
    </AppShell>
  );
}
