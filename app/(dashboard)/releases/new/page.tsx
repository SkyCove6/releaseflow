import { redirect } from "next/navigation";

export default function LegacyReleaseNewRedirectPage() {
  redirect("/dashboard/releases/new");
}

