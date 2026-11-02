// Compliance document attachments (Sharon's action point C2, 28 Oct 2026).
//
// - PDF, JPG, PNG only, checked from the file's own bytes (the task module's
//   signature check), 10 MB at most.
// - Private bucket "compliance"; objects are opened through one-hour signed
//   links minted per request, only for holders of the identity-numbers right.
// - Nothing is deleted: a renewal uploads a new file and the older ones stay
//   as history, each stamped with the item's expiry at upload time.

import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { checkAttachmentSignature } from "@/lib/server/todos/file-signature";

export const COMPLIANCE_BUCKET = "compliance";
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_URL_TTL_SECONDS = 60 * 60;
const ALLOWED = new Set(["pdf", "jpg", "png"]);
export const DOCUMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png";

export const ITEM_KEY_RE = /^(emirates_id|passport|cert:[0-9a-f-]{36})$/;

/*
  Which items accept a file. Certificates always. Emirates ID and passport
  copies wait on Sharon's answer (C2 "Ask Sharon"); flip this to true then.
*/
export const IDENTITY_COPIES_ENABLED = false;

export function itemAcceptsFiles(itemKey: string): boolean {
  if (itemKey.startsWith("cert:")) return true;
  return IDENTITY_COPIES_ENABLED && (itemKey === "emirates_id" || itemKey === "passport");
}

export type DocumentRow = {
  id: string;
  employee_id: string;
  item_key: string;
  expiry_date: string | null;
  file_name: string;
  content_type: string;
  size_bytes: number;
  storage_path: string;
  uploaded_by: string | null;
  created_at: string;
};

export type DocumentWire = Omit<DocumentRow, "storage_path"> & { uploader: string | null; current: boolean };

const SELECT = "id, employee_id, item_key, expiry_date, file_name, content_type, size_bytes, storage_path, uploaded_by, created_at";

/** All files of an employee, newest first; the newest per item is "current". */
export async function listDocuments(admin: SupabaseClient, employeeId: string): Promise<DocumentWire[]> {
  const { data, error } = await admin.from("compliance_documents").select(SELECT).eq("employee_id", employeeId).order("created_at", { ascending: false });
  if (error) {
    if (error.code === "42P01") return [];
    throw new Error(error.message);
  }
  const rows = (data ?? []) as DocumentRow[];
  const uploaderIds = [...new Set(rows.map((r) => r.uploaded_by).filter((v): v is string => Boolean(v)))];
  const names = new Map<string, string>();
  if (uploaderIds.length) {
    const { data: users } = await admin.from("user_profile").select("id, full_name, email").in("id", uploaderIds);
    (users ?? []).forEach((u: { id: string; full_name: string | null; email: string | null }) => names.set(u.id, u.full_name || u.email || ""));
  }
  const seen = new Set<string>();
  return rows.map(({ storage_path: _ignored, ...r }) => {
    void _ignored;
    const current = !seen.has(r.item_key);
    seen.add(r.item_key);
    return { ...r, uploader: r.uploaded_by ? names.get(r.uploaded_by) ?? null : null, current };
  });
}

/** Item keys that have at least one file, per employee (for the reminder list). */
export async function itemsWithDocuments(admin: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await admin.from("compliance_documents").select("employee_id, item_key");
  if (error) return new Set();
  return new Set((data ?? []).map((r: { employee_id: string; item_key: string }) => `${r.employee_id}|${r.item_key}`));
}

export type UploadResult = { ok: true; document: DocumentWire } | { ok: false; status: number; error: string };

export async function storeDocument(
  admin: SupabaseClient,
  input: { employeeId: string; itemKey: string; expiryDate: string | null; fileName: string; bytes: Uint8Array; actorId: string },
): Promise<UploadResult> {
  if (!itemAcceptsFiles(input.itemKey)) return { ok: false, status: 400, error: "Files cannot be attached to this item yet" };
  if (input.bytes.byteLength === 0) return { ok: false, status: 400, error: "The file is empty" };
  if (input.bytes.byteLength > DOCUMENT_MAX_BYTES) return { ok: false, status: 400, error: "The file is larger than 10 MB" };
  const check = checkAttachmentSignature(input.fileName, input.bytes);
  if (!check.ok) return { ok: false, status: 400, error: check.reason };
  if (!ALLOWED.has(check.kind)) return { ok: false, status: 400, error: "Only PDF, JPG and PNG files can be attached" };

  const id = randomUUID();
  const storagePath = `${input.employeeId}/${input.itemKey.replace(":", "_")}/${id}.${check.extension === "jpeg" ? "jpg" : check.extension}`;
  const { error: upError } = await admin.storage.from(COMPLIANCE_BUCKET).upload(storagePath, input.bytes, { contentType: check.contentType, upsert: false });
  if (upError) throw new Error(`Upload failed: ${upError.message}`);

  const { data, error } = await admin
    .from("compliance_documents")
    .insert({
      id,
      employee_id: input.employeeId,
      item_key: input.itemKey,
      expiry_date: input.expiryDate,
      file_name: input.fileName.trim().slice(0, 200),
      content_type: check.contentType,
      size_bytes: input.bytes.byteLength,
      storage_path: storagePath,
      uploaded_by: input.actorId,
    })
    .select(SELECT)
    .single();
  if (error) {
    await admin.storage.from(COMPLIANCE_BUCKET).remove([storagePath]);
    throw new Error(error.message);
  }
  const { storage_path: _ignored, ...row } = data as DocumentRow;
  void _ignored;
  return { ok: true, document: { ...row, uploader: null, current: true } };
}

/** A one-hour signed link for one file, or null when it is missing. */
export async function signDocument(admin: SupabaseClient, documentId: string): Promise<{ url: string; row: DocumentRow } | null> {
  const { data, error } = await admin.from("compliance_documents").select(SELECT).eq("id", documentId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as DocumentRow;
  const { data: signed, error: signError } = await admin.storage
    .from(COMPLIANCE_BUCKET)
    .createSignedUrl(row.storage_path, DOCUMENT_URL_TTL_SECONDS, { download: row.file_name });
  if (signError || !signed?.signedUrl) return null;
  return { url: signed.signedUrl, row };
}
