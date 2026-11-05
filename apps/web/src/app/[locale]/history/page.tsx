import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { HistoryList } from "@/components/history-list";

export default async function HistoryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("history");

  return (
    <AppShell title={t("title")}>
      <HistoryList />
    </AppShell>
  );
}
