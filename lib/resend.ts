import { Resend } from "resend";
import type { AnalyticsReport } from "@/agents/analytics-interpreter";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY!);
}

export async function sendWeeklyReportEmail(
  to: string,
  releaseTitle: string,
  report: AnalyticsReport,
  htmlReport: string
) {
  const subject = `Weekly analytics: "${releaseTitle}" — ${report.highlights[0] ?? "your report is ready"}`;
  await getResend().emails.send({
    from: process.env.EMAIL_FROM ?? "ReleaseFlow <noreply@releaseflow.app>",
    to,
    subject,
    html: htmlReport,
  });
}

export async function sendPaymentFailedEmail(to: string, name: string) {
  await getResend().emails.send({
    from: process.env.EMAIL_FROM ?? "ReleaseFlow <noreply@releaseflow.app>",
    to,
    subject: "Action required: payment failed for your ReleaseFlow subscription",
    html: `
      <p>Hi ${name},</p>
      <p>We were unable to process your latest payment for ReleaseFlow.</p>
      <p>
        Please update your payment method to keep your subscription active:
        <br/>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/settings/billing">
          Update payment method
        </a>
      </p>
      <p>If you have questions, reply to this email and we'll help you out.</p>
      <p>— The ReleaseFlow team</p>
    `,
  });
}
