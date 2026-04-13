import type { AppEnv } from "../config/env.ts";

export class BriefingDelivery {
  constructor(private readonly env: AppEnv) {}

  async sendEmail(to: string, subject: string, body: string): Promise<void> {
    const base = this.env.emailServiceUrl;
    const token = this.env.emailServiceToken;
    if (!base || !token) {
      console.error(
        JSON.stringify({
          level: "error",
          component: "briefing-delivery",
          event: "email_skipped",
          reason: "missing_email_service_env",
        }),
      );
      return;
    }
    const url = `${base}/api/send`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          to,
          subject,
          body,
          format: "markdown",
        }),
      });
      if (!res.ok) {
        const snippet = (await res.text()).slice(0, 200);
        console.error(
          JSON.stringify({
            level: "error",
            component: "briefing-delivery",
            event: "email_failed",
            status: res.status,
            snippet,
            to,
          }),
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        JSON.stringify({
          level: "error",
          component: "briefing-delivery",
          event: "email_error",
          message: msg,
          to,
        }),
      );
    }
  }

  async sendSlack(webhookUrl: string, text: string): Promise<void> {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const snippet = (await res.text()).slice(0, 200);
        console.error(
          JSON.stringify({
            level: "error",
            component: "briefing-delivery",
            event: "slack_failed",
            status: res.status,
            snippet,
          }),
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        JSON.stringify({
          level: "error",
          component: "briefing-delivery",
          event: "slack_error",
          message: msg,
        }),
      );
    }
  }
}
