import type { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "@/components/auth/signup-form";
import { Music2 } from "lucide-react";

export const metadata: Metadata = { title: "Create Account" };

export default function SignupPage({
  searchParams,
}: {
  searchParams?: { ref?: string };
}) {
  const initialReferralCode = searchParams?.ref?.trim().toUpperCase() ?? "";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/50 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <Music2 className="h-10 w-10 text-primary" />
          <h1 className="text-2xl font-bold">ReleaseFlow</h1>
          <p className="text-sm text-muted-foreground">
            Create your account
          </p>
        </div>
        <SignupForm initialReferralCode={initialReferralCode} />
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="underline underline-offset-4 hover:text-primary">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
