/**
 * Development preflight for the configured internal Gemini gateway.
 *
 * DNS + TCP only — never calls Gemini inference and never sends the API key.
 */

import { lookup } from 'node:dns/promises';
import { connect } from 'node:net';
import { describeGatewayConfig, readGatewayConfig } from './config';

export type GatewayPreflightResult = {
  configured: boolean;
  reachable: boolean;
  host: string | null;
  reason: string | null;
};

function tcpConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/**
 * Probe whether the configured gateway host resolves and accepts TCP/443.
 * Safe for logs and HTTP health responses — no secrets.
 */
export async function probeGatewayReachability(options: {
  timeoutMs?: number;
  /** Injected for tests — skip real DNS/TCP. */
  lookupImpl?: typeof lookup;
  tcpConnectImpl?: typeof tcpConnect;
} = {}): Promise<GatewayPreflightResult> {
  const summary = describeGatewayConfig();
  if (!summary.configured) {
    return {
      configured: false,
      reachable: false,
      host: summary.host,
      reason: 'gateway_not_configured'
    };
  }

  let host = summary.host;
  try {
    host = readGatewayConfig().host;
  } catch {
    return {
      configured: false,
      reachable: false,
      host: null,
      reason: 'gateway_not_configured'
    };
  }

  const lookupImpl = options.lookupImpl ?? lookup;
  const connectImpl = options.tcpConnectImpl ?? tcpConnect;
  const timeoutMs = options.timeoutMs ?? 3_000;

  try {
    await lookupImpl(host);
  } catch {
    return {
      configured: true,
      reachable: false,
      host,
      reason: 'dns_unresolved'
    };
  }

  const ok = await connectImpl(host, 443, timeoutMs);
  if (!ok) {
    return {
      configured: true,
      reachable: false,
      host,
      reason: 'tcp_unreachable'
    };
  }

  return {
    configured: true,
    reachable: true,
    host,
    reason: null
  };
}

/** Public health payload — never includes keys, tokens, or full secret URLs. */
export function toPublicGatewayHealth(
  preflight: GatewayPreflightResult
): { configured: boolean; reachable: boolean } {
  return {
    configured: preflight.configured,
    reachable: preflight.reachable
  };
}
