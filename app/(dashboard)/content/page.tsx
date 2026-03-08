import { redirect } from "next/navigation";

export default function LegacyContentRedirectPage() {
  redirect("/dashboard/content");
}

