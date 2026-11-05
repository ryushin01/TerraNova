import { setRequestLocale } from "next-intl/server";
import { SetupForm } from "@/components/auth-forms";

export default async function SetupPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <SetupForm />;
}
