/** Client-IP für Rate-Limiting / Audit (Proxy: X-Forwarded-For). */
export function extractIpFromRequest(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")?.trim();
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}
