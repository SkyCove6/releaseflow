"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, Gift, Users, Award } from "lucide-react";

export default function ReferralsPage() {
  const { data, isLoading } = trpc.referrals.myStats.useQuery();
  const applyMutation = trpc.referrals.applyCode.useMutation({
    onSuccess: () => {
      toast.success("Referral code applied!");
      setRefCode("");
    },
    onError: (err) => toast.error(err.message),
  });

  const [copied, setCopied]   = useState(false);
  const [refCode, setRefCode] = useState("");

  function copyShareUrl() {
    if (!data?.shareUrl) return;
    void navigator.clipboard.writeText(data.shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <Header title="Referrals" />
      <main className="flex-1 p-6 max-w-3xl">
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight">Refer &amp; Earn</h2>
          <p className="text-muted-foreground">
            Invite fellow artists to ReleaseFlow. When they upgrade to a paid plan,
            you both get 1 free month.
          </p>
        </div>

        <div className="space-y-6">
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Total referrals", value: data?.usedCount ?? 0, icon: Users },
              { label: "Credited",        value: data?.credited ?? 0,  icon: Award },
              { label: "Pending",         value: data?.pending ?? 0,   icon: Gift  },
            ].map(({ label, value, icon: Icon }) => (
              <Card key={label}>
                <CardContent className="flex items-center gap-3 pt-5">
                  <Icon className="h-6 w-6 text-indigo-500" />
                  <div>
                    <p className="text-2xl font-bold">{isLoading ? "—" : value}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Share link */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Your referral link</CardTitle>
              <CardDescription>
                Share this link. When someone signs up using it and pays, you both get a free month.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-2">
              <Input
                readOnly
                value={isLoading ? "Loading…" : (data?.shareUrl ?? "")}
                className="font-mono text-sm"
              />
              <Button variant="outline" size="icon" onClick={copyShareUrl} className="shrink-0">
                {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </CardContent>
          </Card>

          {/* Apply a referral code */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Got a referral code?</CardTitle>
              <CardDescription>
                Enter a friend&apos;s code to link their referral to your account.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-2">
              <Input
                placeholder="e.g. ABCD1234-WXYZ"
                value={refCode}
                onChange={(e) => setRefCode(e.target.value.toUpperCase())}
                className="font-mono text-sm max-w-64"
              />
              <Button
                onClick={() => applyMutation.mutate({ code: refCode })}
                disabled={!refCode || applyMutation.isPending}
              >
                Apply
              </Button>
            </CardContent>
          </Card>

          {/* Conversion history */}
          {(data?.conversions.length ?? 0) > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Referral history</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="pb-2">Date</th>
                      <th className="pb-2">Status</th>
                      <th className="pb-2">Credited</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.conversions.map((c, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2">{new Date(c.created_at as string).toLocaleDateString()}</td>
                        <td className="py-2">
                          <Badge variant={c.status === "credited" ? "default" : "secondary"}>
                            {c.status}
                          </Badge>
                        </td>
                        <td className="py-2 text-muted-foreground">
                          {c.credited_at ? new Date(c.credited_at as string).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </>
  );
}
