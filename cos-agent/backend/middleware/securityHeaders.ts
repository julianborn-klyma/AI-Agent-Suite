const SECURITY_HEADER_LINES: [string, string][] = [
  ["Strict-Transport-Security", "max-age=31536000; includeSubDomains"],
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Content-Security-Policy", "default-src 'self'"],
  [
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  ],
];

export function addSecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of SECURITY_HEADER_LINES) {
    if (!headers.has(k)) headers.set(k, v);
  }
  return new Response(res.body, { status: res.status, headers });
}
