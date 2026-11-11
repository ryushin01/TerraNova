import type { Metadata, Viewport } from "next";
import { Nanum_Gothic, Nanum_Gothic_Coding, Roboto, Roboto_Mono } from "next/font/google";
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

// Control screens read numbers first: Roboto and Nanum Gothic for text, Roboto Mono and Nanum Gothic Coding
// so digits and times keep their columns. Korean fonts are split by character range, so only the
// slices a screen uses are fetched (preload: false).
const roboto = Roboto({ subsets: ["latin"], variable: "--font-roboto", display: "swap" });
const nanumGothic = Nanum_Gothic({
  subsets: ["latin"],
  weight: ["400", "700", "800"],
  variable: "--font-nanum-gothic",
  display: "swap",
  preload: false,
});
const robotoMono = Roboto_Mono({ subsets: ["latin"], variable: "--font-roboto-mono", display: "swap" });
const nanumGothicCoding = Nanum_Gothic_Coding({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-nanum-gothic-coding",
  display: "swap",
  preload: false,
});
const fontVariables = [roboto, nanumGothic, robotoMono, nanumGothicCoding].map((font) => font.variable).join(" ");

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
    <html lang={locale} className={fontVariables} suppressHydrationWarning>
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
