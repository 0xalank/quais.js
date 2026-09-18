/** Portable wallet connector protocol. No signer, relay, UI or contract implementation dependencies. */
export const CONNECTOR_PROTOCOL = "quai-wallet" as const;
export interface SendCalls {
  chainId: string;
  account: string;
  calls: { to: string; value: string; data: string }[];
}
export interface WalletAccount {
  address: string;
  chainId: string;
}
export interface WalletCapabilities {
  protocolVersion: 1;
  chainId: string;
  accountProtocol: string;
  actions: string[];
  payment: {
    mode: "sponsored" | "user-paid" | "mixed";
    quotes: boolean;
    guaranteed: false;
    userFeeWei?: string;
  };
}
export interface WalletOperation {
  id: string;
  state:
    | "reserved"
    | "signed"
    | "submitted"
    | "confirmed"
    | "reverted"
    | "uncertain";
  txHash?: string;
}
export interface WalletFeeQuote {
  id: string;
  chainId: string;
  account: string;
  actionHash: string;
  payment: "sponsored" | "user-paid";
  userFeeWei: string;
  expiresAt: string;
}
export const methods = [
  "connect",
  "getAccount",
  "getCapabilities",
  "getFeeQuote",
  "sendCalls",
  "getOperation",
  "disconnect",
] as const;
export type WalletMethod = (typeof methods)[number];
export interface ConnectorRequest {
  protocol: typeof CONNECTOR_PROTOCOL;
  version: 1;
  channel: string;
  id: string;
  method: WalletMethod;
  params: unknown;
}
const uint = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(0|[1-9][0-9]*)$/.test(value) &&
  value.length <= 78 &&
  BigInt(value) < 1n << 256n;
const addr = (value: unknown): value is string =>
  typeof value === "string" &&
  /^0x[a-fA-F0-9]{40}$/.test(value) &&
  !/^0x0{40}$/i.test(value);
export const isConnectorUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  )
    throw new Error("Invalid request shape");
  return value as Record<string, unknown>;
}
export function parseCalls(value: unknown): SendCalls {
  const v = object(value, ["chainId", "account", "calls"]);
  if (
    !uint(v.chainId) ||
    v.chainId === "0" ||
    !addr(v.account) ||
    !Array.isArray(v.calls) ||
    !v.calls.length ||
    v.calls.length > 16
  )
    throw new Error("Invalid calls");
  const calls = v.calls.map((item) => {
    const call = object(item, ["to", "value", "data"]);
    if (
      !addr(call.to) ||
      !uint(call.value) ||
      typeof call.data !== "string" ||
      call.data.length > 60002 ||
      !/^0x(?:[a-fA-F0-9]{2})*$/.test(call.data)
    )
      throw new Error("Invalid call");
    return { to: call.to, value: call.value, data: call.data };
  });
  return { chainId: v.chainId, account: v.account, calls };
}
export function parseRequest(value: unknown): ConnectorRequest {
  const v = object(value, [
    "protocol",
    "version",
    "channel",
    "id",
    "method",
    "params",
  ]);
  if (
    v.protocol !== CONNECTOR_PROTOCOL ||
    v.version !== 1 ||
    !isConnectorUuid(v.channel) ||
    !isConnectorUuid(v.id) ||
    !methods.includes(v.method as WalletMethod)
  )
    throw new Error("Invalid request");
  const method = v.method as WalletMethod;
  parseParams(method, v.params);
  return {
    protocol: CONNECTOR_PROTOCOL,
    version: 1,
    channel: v.channel,
    id: v.id,
    method,
    params: v.params,
  };
}
export function parseParams(method: WalletMethod, params: unknown): unknown {
  if (!methods.includes(method)) throw new Error("Unsupported method");
  if (method === "sendCalls" || method === "getFeeQuote")
    return parseCalls(params);
  if (method === "getOperation") {
    const v = object(params, ["id"]);
    if (typeof v.id !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(v.id))
      throw new Error("Invalid operation ID");
    return { id: v.id };
  }
  return object(params, []);
}
export class WalletConnectorError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WalletConnectorError";
  }
}
export function trustedOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.origin !== value ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw new WalletConnectorError(
      "INVALID_ORIGIN",
      "Use an exact HTTPS origin, or localhost for development.",
    );
  return url.origin;
}
export function boundedMessage(value: unknown): boolean {
  try {
    const encoded = JSON.stringify(value);
    return !!encoded && encoded.length <= 131072;
  } catch {
    return false;
  }
}

/** Validate a wallet response before exposing it to the integrating application. */
export function parseResult(method: WalletMethod, result: unknown): unknown {
  if (method === "disconnect") {
    if (result !== null && result !== undefined)
      throw new Error("Invalid disconnect result");
    return;
  }
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new Error("Invalid wallet result");
  const v = result as Record<string, unknown>;
  if (method === "connect" || method === "getAccount") {
    if (!addr(v.address) || !uint(v.chainId) || v.chainId === "0")
      throw new Error("Invalid account result");
    return { address: v.address, chainId: v.chainId };
  }
  if (method === "sendCalls" || method === "getOperation") {
    if (
      typeof v.id !== "string" ||
      !/^0x[0-9a-f]{64}$/i.test(v.id) ||
      ![
        "reserved",
        "signed",
        "submitted",
        "confirmed",
        "reverted",
        "uncertain",
      ].includes(String(v.state)) ||
      (v.txHash !== undefined &&
        (typeof v.txHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(v.txHash)))
    )
      throw new Error("Invalid operation result");
    return {
      id: v.id,
      state: v.state,
      ...(v.txHash ? { txHash: v.txHash } : {}),
    };
  }
  if (method === "getCapabilities") {
    const p = v.payment as Record<string, unknown> | undefined;
    if (
      v.protocolVersion !== 1 ||
      !uint(v.chainId) ||
      v.chainId === "0" ||
      typeof v.accountProtocol !== "string" ||
      !Array.isArray(v.actions) ||
      !v.actions.every((a) => typeof a === "string") ||
      !p ||
      !["sponsored", "user-paid", "mixed"].includes(String(p.mode)) ||
      typeof p.quotes !== "boolean" ||
      p.guaranteed !== false ||
      (p.userFeeWei !== undefined && !uint(p.userFeeWei))
    )
      throw new Error("Invalid capabilities");
  } else if (method === "getFeeQuote") {
    if (
      typeof v.id !== "string" ||
      !uint(v.chainId) ||
      v.chainId === "0" ||
      !addr(v.account) ||
      typeof v.actionHash !== "string" ||
      !/^0x[0-9a-f]{64}$/i.test(v.actionHash) ||
      !["sponsored", "user-paid"].includes(String(v.payment)) ||
      !uint(v.userFeeWei) ||
      typeof v.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(v.expiresAt))
    )
      throw new Error("Invalid fee quote");
  }
  return result;
}

// Structural browser boundary keeps DOM declarations out of Node and React Native consumers.
export interface MessagePeer {
  postMessage(message: unknown, targetOrigin: string): void;
}
export interface WalletPopup extends MessagePeer {
  readonly closed: boolean;
  focus(): void;
  close(): void;
}
export interface ConnectorMessageEvent {
  origin: string;
  source: unknown;
  data: any;
}
export interface ConnectorBrowser {
  window: {
    open(url: URL, target: string, features: string): WalletPopup | null;
  };
  location: { origin: string };
  crypto: { randomUUID(): string };
  addEventListener(
    type: "message",
    listener: (event: ConnectorMessageEvent) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: ConnectorMessageEvent) => void,
  ): void;
}
export function connectorBrowser(): ConnectorBrowser {
  return globalThis as unknown as ConnectorBrowser;
}
