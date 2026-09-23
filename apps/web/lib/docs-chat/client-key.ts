import { createHmac } from "node:crypto";

export type ClientAddress = {
  address: string;
  source: "x-real-ip" | "x-forwarded-for" | "none";
};

// One IPv6 client holds a whole /64, so counting single addresses is trivially dodged.
function ipv6Prefix(address: string): string {
  const [head = "", tail] = address.replace(/%.*$/, "").split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? front
      : [...front, ...Array<string>(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back];
  const prefix = groups.slice(0, 4).map((group) => Number.parseInt(group || "0", 16).toString(16));
  return `${prefix.join(":")}::/64`;
}

function normalise(address: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped?.[1]) return mapped[1];
  return address.includes(":") ? ipv6Prefix(address.toLowerCase()) : address;
}

/** The client's address as Vercel reports it, or `none`, which every such request shares. */
export function clientAddress(headers: Headers): ClientAddress {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return { address: normalise(real), source: "x-real-ip" };
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return { address: normalise(forwarded), source: "x-forwarded-for" };
  return { address: "unknown", source: "none" };
}

export function rateLimitKey(address: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(`docs-chat-rate-limit\0${address}`).digest("hex");
  return `docs-chat:ip:${digest}`;
}
