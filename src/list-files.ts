/**
 * Lists the files under a folder URL, recursively, through the folder's
 * JSON directory index — the format a web server serves for a directory
 * (nginx `autoindex on; autoindex_format json;`), which the Node platform
 * also answers with for local folders. Plain Babylon.js (Tools.LoadFileAsync),
 * so it runs in a browser against such a server unchanged.
 */
import { Tools } from "@babylonjs/core";

interface IndexEntry {
  name: string;
  type: string;
}

/**
 * URLs of all files below `folderUrl` whose name ends with `extension`
 * (case-insensitive), depth first, in index (name) order. A folder that
 * cannot be read is reported and skipped.
 */
export async function listFiles(folderUrl: string, extension: string): Promise<string[]> {
  const folder = folderUrl.endsWith("/") ? folderUrl : `${folderUrl}/`;
  let entries: IndexEntry[];
  try {
    entries = JSON.parse(await Tools.LoadFileAsync(folder, false)) as IndexEntry[];
  } catch (err) {
    console.warn(`[assets] cannot list ${folder}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
  const urls: string[] = [];
  for (const entry of entries) {
    const url = folder + encodeURIComponent(entry.name);
    if (entry.type === "directory") urls.push(...(await listFiles(`${url}/`, extension)));
    else if (entry.type === "file" && entry.name.toLowerCase().endsWith(extension.toLowerCase())) urls.push(url);
  }
  return urls;
}
