const env = process.env;

export const config = {
  port: Number(env.PORT) || 8080,
  publicUrl: (env.PUBLIC_URL || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:8080')).replace(/\/$/, ''),
  supabaseUrl: env.SUPABASE_URL,
  supabaseKey: env.SUPABASE_SERVICE_ROLE_KEY,
  pipedriveToken: env.PIPEDRIVE_API_TOKEN,
  pipedriveDomain: env.PIPEDRIVE_COMPANY_DOMAIN || null, // e.g. houseofmarketers, for deal links
  pipedriveStageId: Number(env.PIPEDRIVE_NEW_DEAL_STAGE_ID) || 2,
  // monday session tokens are signed with the app's Client Secret; the signing
  // secret is accepted too so either can be configured.
  mondaySecrets: [env.MONDAY_CLIENT_SECRET, env.MONDAY_SIGNING_SECRET].filter(Boolean),
  mondayAccountId: env.MONDAY_ACCOUNT_ID ? Number(env.MONDAY_ACCOUNT_ID) : null,
  // Comma-separated monday user ids allowed in. Empty = everyone in the account.
  allowedUserIds: (env.ALLOWED_MONDAY_USER_IDS || '').split(',').map((s) => Number(s.trim())).filter(Boolean),
  devAuthBypass: env.DEV_AUTH_BYPASS === '1',
  downloadSecret: env.DOWNLOAD_SECRET || env.MONDAY_CLIENT_SECRET || env.MONDAY_SIGNING_SECRET || 'dev',
  // Pipedrive custom field keys written when a package is approved.
  pdFields: {
    projectedMargin: env.PD_FIELD_PROJECTED_MARGIN || '10474f2292cd2b1c7755e1d4341472cec47b51ba',
    numberOfInfluencers: env.PD_FIELD_NUMBER_OF_INFLUENCERS || '311b8cb9e9f1105876dcb27de5d9a2e817b490ab',
    paidMediaSpend: env.PD_FIELD_PAID_MEDIA || '7ad5a2e6ad9452d9049cbbcd823c156603c20862',
    brandUpliftGbp: env.PD_FIELD_BRAND_UPLIFT || '537fa9c731922bf8b04c3a1068067f2f7eed023e',
    targetCountry: env.PD_FIELD_TARGET_COUNTRY || 'ab1c326f472477a647c608640d4cbd1c9b5cce14',
    orgWideNiche: env.PD_FIELD_ORG_WIDE_NICHE || '170e17a7abd9b2aab4ab158a3c5efeabb4a0d1f9',
  },
};
