"use client";

import { Button } from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import { ErrorNotice } from "@/components/error-notice";
import { Link } from "@/i18n/navigation";

export default function NotFoundPage() {
  const t = useTranslations("errors");

  return (
    <>
      <title>{t("notFoundTitle")}</title>
      <ErrorNotice title={t("notFoundTitle")} description={t("notFoundDescription")}>
        <Button asChild>
          <Link href="/">{t("home")}</Link>
        </Button>
      </ErrorNotice>
    </>
  );
}
