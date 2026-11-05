"use client";

import { Button } from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { ErrorNotice } from "@/components/error-notice";
import { Link } from "@/i18n/navigation";

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations("errors");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorNotice title={t("errorTitle")} description={t("errorDescription")}>
      <Button onClick={() => retry()}>{t("retry")}</Button>
      <Button asChild variant="outline">
        <Link href="/">{t("home")}</Link>
      </Button>
    </ErrorNotice>
  );
}
