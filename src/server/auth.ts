import { config, type Project } from "./config";

/** Basic auth with a project's public and secret key, as Langfuse's ingestion API uses. */
export function projectFromAuth(header: string | null): Project | null {
  if (!header?.startsWith("Basic ")) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return null;
  }
  const i = decoded.indexOf(":");
  if (i < 0) return null;
  const pk = decoded.slice(0, i);
  const sk = decoded.slice(i + 1);
  return config().projects.find((p) => p.public_key === pk && p.secret_key === sk) ?? null;
}

/** The explorer reads one project; in this repository there is no user login. */
export function readProject(): string {
  return process.env.EXPLORER_PROJECT ?? config().projects[0].id;
}
