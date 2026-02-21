import type { Hex } from "viem";

// ERC-8021 Schema 0 (Canonical Registry) data suffix.
// Format (see Ox examples):
//   <utf8("code1,code2,...")><len:1 byte><schemaId:1 byte (0)><marker:16 bytes>
// Marker is 0x8021 repeated 8 times.

const MARKER_NO_0X = "80218021802180218021802180218021"; // 16 bytes

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function getCodesFromEnv(): string[] {
  const many = (process.env.NEXT_PUBLIC_BUILDER_CODES ?? "").trim();
  const one = (process.env.NEXT_PUBLIC_BUILDER_CODE ?? "").trim();

  const raw = many.length ? many : one;
  if (!raw.length) return [];

  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isBuilderCodesEnabled(): boolean {
  return getCodesFromEnv().length > 0;
}

export function getBuilderCodesDataSuffix(): Hex {
  const codes = getCodesFromEnv();
  if (!codes.length) return "0x" as Hex;

  // ERC-8021 Schema 0 uses a comma-separated list.
  const joined = codes.join(",");
  const bytes = new TextEncoder().encode(joined);

  // Length is a single byte.
  if (bytes.length > 255) return "0x" as Hex;

  const lenHex = bytes.length.toString(16).padStart(2, "0");
  const schemaHex = "00";

  return ("0x" + bytesToHex(bytes) + lenHex + schemaHex + MARKER_NO_0X) as Hex;
}

export function appendBuilderCodesToCalldata(data?: Hex): Hex | undefined {
  const suffix = getBuilderCodesDataSuffix();
  if (suffix === ("0x" as Hex)) return data;

  const base = (data ?? ("0x" as Hex)).toString();
  const extra = suffix.slice(2);
  return (base + extra) as Hex;
}
