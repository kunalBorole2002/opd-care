import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

function getStorageConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET;

  if (!url || !serviceRoleKey || !bucket) {
    throw new Error(
      "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_STORAGE_BUCKET must be configured.",
    );
  }

  return { url, serviceRoleKey, bucket };
}

function getSupabaseAdmin() {
  if (!client) {
    const { url, serviceRoleKey } = getStorageConfig();
    client = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
  }

  return client;
}

export function storageObjectPath(...segments: string[]) {
  const path = segments
    .flatMap((segment) => segment.replace(/\\/g, "/").split("/"))
    .filter(Boolean);

  if (!path.length || path.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Supabase Storage object path is invalid.");
  }

  return path.join("/");
}

export async function uploadStorageObject({
  objectPath,
  body,
  contentType,
  upsert = false,
}: {
  objectPath: string;
  body: Buffer | Uint8Array | ArrayBuffer | string;
  contentType: string;
  upsert?: boolean;
}) {
  const { bucket } = getStorageConfig();
  const normalizedPath = storageObjectPath(objectPath);
  const { error } = await getSupabaseAdmin().storage.from(bucket).upload(normalizedPath, body, {
    contentType,
    upsert,
  });

  if (error) {
    throw new Error(`Supabase Storage upload failed for ${normalizedPath}: ${error.message}`);
  }

  return normalizedPath;
}

export async function downloadStorageObject(objectPath: string) {
  const { bucket } = getStorageConfig();
  const normalizedPath = storageObjectPath(objectPath);
  const { data, error } = await getSupabaseAdmin().storage.from(bucket).download(normalizedPath);

  if (error) {
    throw new Error(`Supabase Storage download failed for ${normalizedPath}: ${error.message}`);
  }

  return Buffer.from(await data.arrayBuffer());
}

export async function removeStorageObjects(objectPaths: string[]) {
  if (!objectPaths.length) return;

  const { bucket } = getStorageConfig();
  const normalizedPaths = [...new Set(objectPaths.map((objectPath) => storageObjectPath(objectPath)))];
  const { error } = await getSupabaseAdmin().storage.from(bucket).remove(normalizedPaths);

  if (error) {
    throw new Error(`Supabase Storage deletion failed: ${error.message}`);
  }
}
