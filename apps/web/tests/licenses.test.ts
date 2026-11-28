import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * The HEIC decoder (heic-to, with libheif and libde265) is LGPL-3.0: the built site must carry its notice, the LGPL and
 * GPL texts and the corresponding source of exactly the bundled versions (public/licenses/). These checks keep them in
 * step with the installed package, so an upgrade can't leave stale notices or source behind.
 */
const licenses = fileURLToPath(new URL("../public/licenses/", import.meta.url));
const heicTo = fileURLToPath(new URL("../node_modules/heic-to/", import.meta.url));

describe("the HEIC decoder's license materials", () => {
  it("name the installed versions, with both license texts", async () => {
    const pkg = JSON.parse(await readFile(`${heicTo}package.json`, "utf8")) as { version: string; license: string };
    const readme = await readFile(`${heicTo}README.md`, "utf8");
    const libheif = readme.match(/\| (\d+\.\d+\.\d+)\s+\| (\d+\.\d+\.\d+)\s+\|/)!; // newest release row: heic-to → libheif
    expect(libheif[1]).toBe(pkg.version);
    const libde265 = readme.match(/LIBDE265_VERSION=(\d+\.\d+\.\d+)/)![1];
    const notice = await readFile(`${licenses}THIRD-PARTY-NOTICES.txt`, "utf8");
    expect(pkg.license).toBe("LGPL-3.0");
    for (const text of [`heic-to ${pkg.version}`, `libheif ${libheif[2]}`, `libde265 ${libde265}`, `LIBDE265_VERSION=${libde265}`, "LGPL-3.0.txt", "GPL-3.0.txt"]) expect(notice).toContain(text);
    expect(await readFile(`${licenses}LGPL-3.0.txt`, "utf8")).toMatch(/^\s+GNU LESSER GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/);
    const gpl = await readFile(`${licenses}GPL-3.0.txt`, "utf8");
    expect(gpl).toMatch(/^\s+GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/);
    expect(gpl).toContain("END OF TERMS AND CONDITIONS");
  });
  it("ship the corresponding source archives their checksums describe", async () => {
    const sums = (await readFile(`${licenses}source/SHA256SUMS`, "utf8")).trim().split("\n").map(line => line.split(/\s+/));
    expect(sums.map(([, name]) => name)).toEqual(["heic-to-1.6.7.tgz", "libheif-1.23.7.tar.gz", "libde265-1.0.16.tar.gz"]);
    for (const [hash, name] of sums) expect(createHash("sha256").update(await readFile(`${licenses}source/${name}`)).digest("hex")).toBe(hash);
    const notice = await readFile(`${licenses}THIRD-PARTY-NOTICES.txt`, "utf8");
    for (const [, name] of sums) expect(notice).toContain(`source/${name}`);
  });
});
