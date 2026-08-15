/**
 * One IMS token attempt only. No Gemini. No Firefly storage/generate.
 * Run: node --use-system-ca server/ai/firefly/imsOneShot.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const IMS = 'https://ims-na1.adobelogin.com/ims/token/v3';
const SCOPE =
  'openid,AdobeID,session,additional_info,read_organizations,firefly_api,ff_apis';
const REPORT = resolve(process.cwd(), 'server/ai/firefly/ims-oneshot-report.json');

function loadEnv(path) {
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

loadEnv(resolve(process.cwd(), '.env'));

const report = {
  NODE_OPTIONS: process.env.NODE_OPTIONS ?? null,
  nodeArgvHasUseSystemCa: process.execArgv.includes('--use-system-ca'),
  clientIdPresent: Boolean(process.env.ADOBE_FIREFLY_CLIENT_ID),
  clientSecretPresent: Boolean(process.env.ADOBE_FIREFLY_CLIENT_SECRET),
  imsEndpoint: IMS,
  scope: SCOPE,
  tls: { ok: false },
  ims: {},
  providerLimits: {
    geminiCalls: 0,
    imsAttempts: 0,
    fireflyStorageCalls: 0,
    fireflyGenerationCalls: 0
  }
};

try {
  const tls = await fetch('https://ims-na1.adobelogin.com/', { method: 'HEAD' });
  report.tls = { ok: true, status: tls.status };
} catch (e) {
  report.tls = {
    ok: false,
    message: e instanceof Error ? e.message : String(e),
    cause: e?.cause?.code ?? null
  };
  writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

if (!report.clientIdPresent || !report.clientSecretPresent) {
  writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

const body = new URLSearchParams({
  grant_type: 'client_credentials',
  client_id: process.env.ADOBE_FIREFLY_CLIENT_ID,
  client_secret: process.env.ADOBE_FIREFLY_CLIENT_SECRET,
  scope: SCOPE
});

report.providerLimits.imsAttempts = 1;

const res = await fetch(IMS, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body
});

const text = await res.text();
const ctype = res.headers.get('content-type');
let json = null;
try {
  json = JSON.parse(text);
} catch {
  json = null;
}

report.ims = {
  httpStatus: res.status,
  contentType: ctype,
  accessTokenReturned: Boolean(json?.access_token),
  tokenType: json?.token_type ?? null,
  expiresIn: json?.expires_in ?? null,
  grantedScope: json?.scope ?? json?.scopes ?? null
};

if (!report.ims.accessTokenReturned) {
  const adobeError = json?.error ?? null;
  const adobeErrorDescription = json?.error_description ?? null;
  report.ims.adobeError = adobeError;
  report.ims.adobeErrorDescription = adobeErrorDescription;
  if (!json) {
    report.ims.sanitizedBodyPreview = String(text)
      .slice(0, 300)
      .replace(/"access_token"\s*:\s*"[^"]+"/gi, '"access_token":"[REDACTED]"');
  }
  const err = `${adobeError ?? ''} ${adobeErrorDescription ?? ''}`;
  let cls = 'other Adobe IMS response';
  if (/invalid_client/i.test(err) && !/secret/i.test(err)) cls = 'invalid client';
  else if (/invalid_client_secret|client_secret/i.test(err)) cls = 'invalid secret';
  else if (/invalid_scope|scope/i.test(err)) cls = 'invalid scope';
  else if (/entitlement|product|api not|forbidden/i.test(err)) cls = 'missing entitlement';
  else if (/organization|org/i.test(err)) cls = 'organization/project mismatch';
  else if (/invalid_client/i.test(err)) cls = 'invalid client';
  report.rootCauseClassification = cls;
  report.consoleChangesStillRequired = true;
} else {
  report.rootCauseClassification = null;
  report.consoleChangesStillRequired = false;
}

writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
