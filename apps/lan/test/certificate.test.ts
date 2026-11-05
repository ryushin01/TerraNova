import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSelfSignedCertificate, loadTrustedCertificate } from "../src/certificate";

const root = mkdtempSync(join(tmpdir(), "terranova-cert-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("a trusted certificate is used when both files are given", () => {
  const cert = join(root, "cert.pem");
  const key = join(root, "key.pem");
  writeFileSync(cert, "CERT");
  writeFileSync(key, "KEY");
  expect(loadTrustedCertificate(cert, key)).toEqual({ cert: "CERT", key: "KEY" });
  expect(loadTrustedCertificate()).toBeNull();
});

test.each([
  ["cert.pem", undefined],
  [undefined, "key.pem"],
])("giving only one file is an error rather than a silent fallback", (cert, key) => {
  expect(() => loadTrustedCertificate(cert, key)).toThrow("both");
});

test("a self-signed certificate is reused, and remade when the address changes", () => {
  const dir = join(root, "self");
  const first = loadSelfSignedCertificate(dir, "192.168.0.10");
  expect(first.cert).toContain("BEGIN CERTIFICATE");
  expect(loadSelfSignedCertificate(dir, "192.168.0.10").cert).toBe(first.cert);
  expect(loadSelfSignedCertificate(dir, "192.168.0.11").cert).not.toBe(first.cert);
  expect(readFileSync(join(dir, "address"), "utf8")).toBe("192.168.0.11");
  expect(statSync(dir).mode & 0o077).toBe(0);
});
