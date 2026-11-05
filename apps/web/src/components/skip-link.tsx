"use client";

import { SkipNavLink } from "@chakra-ui/react";
import { useTranslations } from "next-intl";

/** The id every page's main landmark carries, so the link below has somewhere to go. */
export const MAIN_ID = "main";

/** Lets keyboard users jump past the repeated navigation. Hidden until it takes focus. */
export function SkipLink() {
  const t = useTranslations("nav");
  return <SkipNavLink id={MAIN_ID} zIndex="skipNav">{t("skipToMain")}</SkipNavLink>;
}
