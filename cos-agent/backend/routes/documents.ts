import type { AppEnv } from "../config/env.ts";
import type { AppDependencies } from "../app_deps.ts";
import { DocumentNotFoundError } from "../services/documentService.ts";
import { requireAuth } from "../middleware/auth.ts";
import { jsonResponse } from "./json.ts";

const VALID_TYPES = new Set([
  "business_plan",
  "meeting_summary",
  "financial_report",
  "other",
]);

const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

const MAX_BYTES = 10 * 1024 * 1024;

function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}

function notFound(): Response {
  return new Response("Not Found", { status: 404 });
}

export async function handleDocumentsPost(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return unauthorized();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonResponse({ error: "Ungültiges multipart/form-data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return jsonResponse({ error: "file fehlt." }, { status: 400 });
  }

  const documentType = String(form.get("document_type") ?? "").trim();
  if (!documentType || !VALID_TYPES.has(documentType)) {
    return jsonResponse({ error: "document_type ungültig oder fehlt." }, { status: 400 });
  }

  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) {
    return jsonResponse(
      { error: "Datei zu groß (max 10 MB)" },
      { status: 413 },
    );
  }

  const mimeType = (file.type || "application/octet-stream").trim().toLowerCase();
  const normalizedMime = mimeType.split(";")[0]!.trim();
  if (!ALLOWED_MIME.has(normalizedMime)) {
    return jsonResponse({ error: "MIME-Typ nicht erlaubt." }, { status: 415 });
  }

  const nameRaw = form.get("name");
  const name = (typeof nameRaw === "string" && nameRaw.trim())
    ? nameRaw.trim()
    : (file.name || "upload").trim() || "upload";

  try {
    const doc = await deps.documentService.processUpload({
      userId,
      name,
      documentType,
      content: buf,
      mimeType: normalizedMime,
    });
    return jsonResponse(
      {
        id: doc.id,
        name: doc.name,
        document_type: doc.document_type,
        summary: doc.summary,
        created_at: doc.created_at,
      },
      { status: 201 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: msg }, { status: 500 });
  }
}

export async function handleDocumentsList(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return unauthorized();

  const url = new URL(req.url);
  const dt = url.searchParams.get("document_type")?.trim();
  const rows = await deps.db.getDocuments(userId, {
    document_type: dt || undefined,
    limit: 200,
  });
  return jsonResponse(
    rows.map((d) => ({
      id: d.id,
      name: d.name,
      document_type: d.document_type,
      summary: d.summary,
      processed: d.processed,
      created_at: d.created_at,
    })),
  );
}

export async function handleDocumentGet(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  id: string,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return unauthorized();

  const doc = await deps.db.getDocument(id, userId);
  if (!doc) return notFound();

  const chunks = await deps.db.getChunks(id, userId);
  return jsonResponse({
    ...doc,
    chunks: chunks.map((c) => ({
      chunk_index: c.chunk_index,
      page_number: c.page_number,
      section_title: c.section_title,
      token_count: c.token_count,
    })),
  });
}

export async function handleDocumentDelete(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  id: string,
): Promise<Response> {
  if (req.method !== "DELETE") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return unauthorized();

  try {
    await deps.db.deleteDocument(id, userId);
  } catch {
    return notFound();
  }
  return jsonResponse({ deleted: true });
}

export async function handleDocumentAsk(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  id: string,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }
  const o = body as Record<string, unknown>;
  const question = typeof o.question === "string" ? o.question.trim() : "";
  if (!question) {
    return jsonResponse({ error: "question fehlt oder leer." }, { status: 400 });
  }
  if (question.length > 1000) {
    return jsonResponse({ error: "question zu lang (max 1000)." }, { status: 400 });
  }

  try {
    const result = await deps.documentService.askDocument({
      documentId: id,
      userId,
      question,
    });
    return jsonResponse(result);
  } catch (e) {
    if (e instanceof DocumentNotFoundError) return notFound();
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: msg }, { status: 500 });
  }
}

export async function handleDocumentVerify(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  id: string,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return unauthorized();

  const doc = await deps.db.getDocument(id, userId);
  if (!doc) return notFound();

  try {
    const v = await deps.documentService.verifyDocument({
      documentId: id,
      userId,
    });
    return jsonResponse(v);
  } catch (e) {
    if (e instanceof DocumentNotFoundError) return notFound();
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: msg }, { status: 500 });
  }
}
