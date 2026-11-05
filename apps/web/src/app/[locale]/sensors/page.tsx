import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { SensorCharts } from "@/components/sensor-charts";

export default async function SensorsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("sensors");

  return (
    <AppShell title={t("title")}>
      <SensorCharts />
    </AppShell>
  );
}
