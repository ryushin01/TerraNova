import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Certificate {
  key: string;
  cert: string;
}

/**
 * A certificate the browser already trusts, such as one from mkcert, if both files are given.
 * Service workers and so Web Push only work with a trusted certificate.
 */
export function loadTrustedCertificate(certFile?: string, keyFile?: string): Certificate | null {
  if (!certFile && !keyFile) return null;
  if (!certFile || !keyFile) throw new Error("Set both LAN_CERT_FILE and LAN_KEY_FILE, or neither.");
  return { cert: readFileSync(certFile, "utf8"), key: readFileSync(keyFile, "utf8") };
}

/** A self-signed certificate for this address, remade when the address changes. */
export function loadSelfSignedCertificate(dir: string, address: string): Certificate {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  const addressPath = join(dir, "address");
  const current = existsSync(addressPath) && readFileSync(addressPath, "utf8") === address;
  if (!current || !existsSync(keyPath) || !existsSync(certPath)) {
    rmSync(keyPath, { force: true });
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "365",
        "-subj",
        "/CN=TerraNova",
        "-addext",
        `subjectAltName=IP:${address},IP:127.0.0.1,DNS:localhost`,
      ],
      { stdio: "ignore" },
    );
    writeFileSync(addressPath, address);
  }
  return { key: readFileSync(keyPath, "utf8"), cert: readFileSync(certPath, "utf8") };
}
