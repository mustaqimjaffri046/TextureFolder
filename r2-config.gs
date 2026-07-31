// ─── Cloudflare R2 Configuration ─────────────────
// Fill in your Cloudflare R2 bucket credentials below.
// For production, use Script Properties (see instructions at bottom).
// ─────────────────────────────────────────────────

function getR2Config() {
  return {
    accountId:       '79ca6fa44a6566d5b126d622efbc51ec',
    accessKeyId:     'f53fa490d0cc88e34cc1d8276ffaf0a3',
    secretAccessKey: '614a63224b36fe12a0219674415917363f4aafa3ac34bf7bf75939b96b2fdb77',
    bucketName:      'sitevisionmodelstextures',
    publicUrl:       'https://pub-0017f2bbdb3c4e3386c33ab71064496c.r2.dev',
    region:          'auto'
  };
}
