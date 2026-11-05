import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { Provider } from "@/components/provider";
import { SkipLink } from "@/components/skip-link";
import { Toaster } from "@/components/toaster";
import { routing } from "@/i18n/routing";

interface Props {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

const pretendard = localFont({
  src: "../../fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "45 920",
  display: "swap",
});

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Omit<Props, "children">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app" });
  return { title: t("name"), description: t("description") };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html lang={locale} className={pretendard.variable} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider>
          <Provider>
            <SkipLink />
            {children}
            <Toaster />
          </Provider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
