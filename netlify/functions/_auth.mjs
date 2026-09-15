import { createRemoteJWKSet, jwtVerify } from "jose";

const DOMAIN = "dev-k8fshtox4w7pm3ah.us.auth0.com";
const ISSUER = `https://${DOMAIN}/`;
const AUDIENCE = process.env.AUTH0_AUDIENCE || "https://api.mdh-api.com";
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}.well-known/jwks.json`));

export async function requireUser(request) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new Error("missing_token");

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return payload;
  } catch {
    throw new Error("invalid_token");
  }
}
