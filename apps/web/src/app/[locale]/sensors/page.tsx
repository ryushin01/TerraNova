import { Container } from "@chakra-ui/react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader } from "@/components/app-header";
import { SensorCharts } from "@/components/sensor-charts";

export default async function SensorsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("sensors");

  return (
    <Container maxW="5xl" px={{ base: "4", md: "6" }} py={{ base: "4", md: "8" }}>
      <AppHeader title={t("title")} />
      <SensorCharts />
    </Container>
  );
}
