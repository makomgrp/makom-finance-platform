"use server";

import { cookies } from "next/headers";
import { LOCALE_COOKIE_NAME, type Locale } from "@/i18n/config";

export async function setLocale(locale: Locale) {
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE_NAME, locale, {
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
  });
}
