import crypto from "node:crypto";

function encryptionKey() {
  const secret =
    process.env.IMAP_CREDENTIALS_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY;
  if (!secret) throw new Error("imap_encryption_key_missing");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptImapPassword(password) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return {
    encrypted_password: encrypted.toString("base64"),
    encryption_iv: iv.toString("base64"),
    encryption_tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptImapPassword(credential) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(credential.encryption_iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(credential.encryption_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(credential.encrypted_password, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
