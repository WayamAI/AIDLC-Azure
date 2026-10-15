import { apiClient } from "@/lib/api";

/** Reads the filename from a Content-Disposition header, falling back to "app.zip". */
function filenameFrom(disposition: string | undefined): string {
  if (!disposition) return "app.zip";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // fall through to the plain filename parameter
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain ? plain[1].trim() : "app.zip";
}

/** Downloads the generated project of an App Builder workspace as a zip. Throws on failure. */
export async function downloadWorkspaceZip(workspaceId: string): Promise<void> {
  const response = await apiClient.get<Blob>(
    `/ai-ide/workspace/${encodeURIComponent(workspaceId)}/download`,
    { responseType: "blob" },
  );
  const filename = filenameFrom(response.headers["content-disposition"]);
  const url = URL.createObjectURL(response.data);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Revoke after the browser has had a chance to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
