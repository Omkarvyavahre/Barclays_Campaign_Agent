/**
 * One-shot Firefly IMS authentication diagnosis.
 * Gemini = 0. Firefly storage/generate = 0. IMS attempts = 1.
 *
 * Usage: npx tsx server/ai/firefly/imsDiagnose.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const IMS_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';
const FIREFLY_API_BASE = 'https://firefly-api.adobe.io';
const IMPLEMENTED_SCOPE =
  'openid,AdobeID,session,additional_info,read_organizations,firefly_api,ff_apis';

const REPORT_PATH = resolve(process.cwd(), 'server/ai/firefly/ims-diagnosis-report.json');

function loadEnvFile(path: string): void {
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function redact(text: string): string {
  return text
    .replace(/("access_token"\s*:\s*")[^"]+"/gi, '$1[REDACTED]"')
    .replace(/("refresh_token"\s*:\s*")[^"]+"/gi, '$1[REDACTED]"')
    .replace(/client_secret=[^&\s]+/gi, 'client_secret=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]');
}

function classify(status: number, body: string): {
  classification: string;
  codeNeedsChanging: boolean;
  consoleNeedsChanging: boolean;
  manualActions: string[];
} {
  const lower = body.toLowerCase();
  const errorMatch =
    /"error"\s*:\s*"([^"]+)"/i.exec(body) ||
    /"errorCode"\s*:\s*"([^"]+)"/i.exec(body) ||
    /error_code=([^&\s]+)/i.exec(body);
  const error = (errorMatch?.[1] || '').toLowerCase();

  if (status === 0 || /fetch failed|enotfound|cert|ssl|econnrefused|etimedout/i.test(body)) {
    return {
      classification: 'Network/certificate issue',
      codeNeedsChanging: false,
      consoleNeedsChanging: false,
      manualActions: [
        'Verify outbound HTTPS access to ims-na1.adobelogin.com from this machine/network.'
      ]
    };
  }

  if (
    status === 400 &&
    (/invalid_scope/i.test(error) || /invalid_scope/i.test(lower) || /scope/i.test(error))
  ) {
    return {
      classification: 'Invalid scopes',
      codeNeedsChanging: false,
      consoleNeedsChanging: true,
      manualActions: [
        'In Adobe Developer Console, open the OAuth Server-to-Server credential.',
        'Confirm the credential has Firefly Services / Firefly API product added.',
        'Align requested scopes with scopes shown for that credential (do not invent undocumented scopes).',
        'If firefly_api / ff_apis are missing from the credential, add Firefly Services API to the project and regenerate/assign scopes.'
      ]
    };
  }

  if (
    status === 401 ||
    status === 400 ||
    /invalid_client|invalid_client_id|invalid_client_secret|unauthorized|access_denied/i.test(
      `${error} ${lower}`
    )
  ) {
    const looksLikeScope =
      /invalid_scope|scope/i.test(error) || /requested scope/i.test(lower);
    if (looksLikeScope) {
      return {
        classification: 'Invalid scopes',
        codeNeedsChanging: false,
        consoleNeedsChanging: true,
        manualActions: [
          'Match the scope string to scopes assigned on the OAuth Server-to-Server credential.',
          'Ensure Firefly Services API is added to the same Adobe project as the credential.'
        ]
      };
    }
    return {
      classification: 'Invalid client credentials',
      codeNeedsChanging: false,
      consoleNeedsChanging: true,
      manualActions: [
        'Confirm the correct Adobe Developer Console project is selected.',
        'Confirm Client ID comes from the OAuth Server-to-Server credential on that project.',
        'Confirm Client Secret belongs to the same credential (not a different project/user-token app).',
        'If the secret was rotated, update ADOBE_FIREFLY_CLIENT_SECRET.',
        'Confirm Firefly Services / Firefly API is added to that project and entitlement is active.'
      ]
    };
  }

  if (/organization|org_id|ims_org/i.test(lower)) {
    return {
      classification: 'Organization mismatch',
      codeNeedsChanging: false,
      consoleNeedsChanging: true,
      manualActions: [
        'Confirm credentials belong to the Adobe organization that holds the Firefly Services entitlement.',
        'Switch to the correct org/project in Adobe Developer Console and copy Client ID/Secret from that credential only.'
      ]
    };
  }

  if (/firefly|entitlement|product not|api not|forbidden|not entitled/i.test(lower)) {
    return {
      classification: 'Missing Firefly entitlement/API',
      codeNeedsChanging: false,
      consoleNeedsChanging: true,
      manualActions: [
        'Add Firefly Services / Firefly API to the Adobe Developer Console project.',
        'Confirm Firefly Services entitlement/access is active for the organization.',
        'Ensure the OAuth Server-to-Server credential includes Firefly scopes after the product is added.'
      ]
    };
  }

  return {
    classification: 'Unclassified IMS response — inspect sanitized error below',
    codeNeedsChanging: false,
    consoleNeedsChanging: true,
    manualActions: [
      'Review the sanitized IMS error in Adobe Developer Console context.',
      'Verify project, credential, scopes, and Firefly Services product assignment.'
    ]
  };
}

async function main(): Promise<void> {
  loadEnvFile(resolve(process.cwd(), '.env'));

  const clientIdPresent = Boolean(process.env.ADOBE_FIREFLY_CLIENT_ID?.trim());
  const clientSecretPresent = Boolean(process.env.ADOBE_FIREFLY_CLIENT_SECRET?.trim());
  const orgIdPresent = Boolean(
    process.env.ADOBE_IMS_ORG_ID?.trim() ||
      process.env.ADOBE_ORG_ID?.trim() ||
      process.env.FIREFLY_ORG_ID?.trim()
  );

  const configInspection = {
    clientIdEnvVar: 'ADOBE_FIREFLY_CLIENT_ID',
    clientIdPresent,
    clientSecretEnvVar: 'ADOBE_FIREFLY_CLIENT_SECRET',
    clientSecretPresent,
    imsOrgIdEnvVarsChecked: ['ADOBE_IMS_ORG_ID', 'ADOBE_ORG_ID', 'FIREFLY_ORG_ID'],
    imsOrgIdPresent: orgIdPresent,
    imsOrgIdUsedByClient: false,
    fireflyApiBase: FIREFLY_API_BASE,
    imsTokenEndpoint: IMS_TOKEN_URL,
    requestedScope: IMPLEMENTED_SCOPE,
    requestFormat: {
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      grantType: 'client_credentials',
      fields: ['grant_type', 'client_id', 'client_secret', 'scope'],
      matchesAdobeContract: true
    },
    scopesInvestigated: [
      'openid',
      'AdobeID',
      'session',
      'additional_info',
      'read_organizations',
      'firefly_api',
      'ff_apis'
    ],
    fireflyEnterpriseIncluded: false,
    fireflyEnterpriseNote:
      'Not requested. Do not add firefly_enterprise unless Adobe Developer Console shows it for this credential.'
  };

  if (!clientIdPresent || !clientSecretPresent) {
    writeFileSync(
      REPORT_PATH,
      JSON.stringify(
        {
          success: false,
          stage: 'precheck',
          configInspection,
          geminiCalls: 0,
          imsAttempts: 0,
          fireflyGenerationCalls: 0,
          fireflyStorageCalls: 0
        },
        null,
        2
      )
    );
    console.error('Missing Client ID or Client Secret env presence — see ims-diagnosis-report.json');
    process.exit(1);
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.ADOBE_FIREFLY_CLIENT_ID!,
    client_secret: process.env.ADOBE_FIREFLY_CLIENT_SECRET!,
    scope: IMPLEMENTED_SCOPE
  });

  let status = 0;
  let contentType = '';
  let rawBody = '';
  let networkError: string | null = null;

  try {
    const response = await fetch(IMS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    status = response.status;
    contentType = response.headers.get('content-type') || '';
    rawBody = await response.text();
  } catch (error) {
    networkError = error instanceof Error ? error.message : String(error);
    rawBody = networkError;
  }

  const sanitizedBody = redact(rawBody).slice(0, 800);
  const errorCode =
    /"error"\s*:\s*"([^"]+)"/i.exec(rawBody)?.[1] ||
    /"errorCode"\s*:\s*"([^"]+)"/i.exec(rawBody)?.[1] ||
    /error_code=([^&\s]+)/i.exec(rawBody)?.[1] ||
    null;
  const errorDescription =
    /"error_description"\s*:\s*"([^"]+)"/i.exec(rawBody)?.[1] ||
    /"message"\s*:\s*"([^"]+)"/i.exec(rawBody)?.[1] ||
    /error_description=([^&]+)/i.exec(rawBody)?.[1]?.replace(/\+/g, ' ') ||
    null;

  const hasAccessToken = /"access_token"\s*:/i.test(rawBody);
  const classification = classify(status, rawBody || networkError || '');

  // Request-format defect only if Adobe indicates malformed request distinctly.
  let finalClassification = classification.classification;
  let codeNeedsChanging = classification.codeNeedsChanging;
  if (/unsupported_grant_type|invalid_request/i.test(String(errorCode)) && status >= 400) {
    // Our format matches documented contract; still flag for review if Adobe says invalid_request.
    if (/unsupported_grant_type/i.test(String(errorCode))) {
      finalClassification = 'Request-format defect';
      codeNeedsChanging = true;
    }
  }

  const report = {
    success: Boolean(status === 200 && hasAccessToken),
    configInspection,
    imsResult: {
      httpStatus: status || null,
      contentType: contentType || null,
      adobeErrorCode: errorCode,
      adobeErrorMessage: errorDescription ? redact(errorDescription) : null,
      sanitizedBodyPreview: sanitizedBody,
      accessTokenReturned: hasAccessToken,
      networkError: networkError ? redact(networkError) : null
    },
    rootCauseClassification: finalClassification,
    codeNeedsChanging,
    consoleNeedsChanging: classification.consoleNeedsChanging,
    manualActionsRequired: classification.manualActions,
    developerConsoleChecklist: [
      'Select the correct Adobe organization',
      'Open the correct Developer Console project',
      'Confirm Firefly Services / Firefly API is added to the project',
      'Confirm an OAuth Server-to-Server credential exists',
      'Confirm ADOBE_FIREFLY_CLIENT_ID is that credential Client ID',
      'Confirm ADOBE_FIREFLY_CLIENT_SECRET is that credential Client Secret',
      'Confirm the credential lists Firefly scopes/API (firefly_api, ff_apis, etc.)',
      'Confirm Firefly Services entitlement/access is active',
      'Do not create new credentials automatically from this diagnosis'
    ],
    providerLimits: {
      geminiCalls: 0,
      imsAttempts: 1,
      fireflyStorageCalls: 0,
      fireflyGenerationCalls: 0
    }
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log('IMS diagnosis complete — server/ai/firefly/ims-diagnosis-report.json');
  console.log(
    JSON.stringify(
      {
        httpStatus: report.imsResult.httpStatus,
        adobeErrorCode: report.imsResult.adobeErrorCode,
        classification: report.rootCauseClassification,
        accessTokenReturned: report.imsResult.accessTokenReturned,
        geminiCalls: 0,
        imsAttempts: 1,
        fireflyGenerationCalls: 0
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        providerLimits: {
          geminiCalls: 0,
          imsAttempts: 0,
          fireflyStorageCalls: 0,
          fireflyGenerationCalls: 0
        }
      },
      null,
      2
    )
  );
  console.error(error);
  process.exit(1);
});
