// ─── Google Apps Script Backend ─────────────────────────
// Deploy this as a Web App (Execute as: Me, Who has access: Anyone).
// Handles: texture uploads, model uploads, catalog hierarchy JSON.
// All stored in the same Drive folder, config in the same Doc.
// ─────────────────────────────────────────────────────────

const DRIVE_FOLDER_ID = '1hXJn3iztH2h7ut0S4rqxGCT2xp4RO6ES';
const DOC_ID = '1a_LBsFKrQ85H4vBpGaediOrMXNnKGH6be6bpE7sfqXE';
const MODELS_SUBFOLDER = 'CatalogModels';

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    if (action === 'save')              return handleSaveTextures(data);
    if (action === 'load')              return handleLoadTextures();
    if (action === 'uploadTexture')     return handleUploadTexture(data);
    if (action === 'saveCatalog')       return handleSaveCatalog(data);
    if (action === 'loadCatalog')       return handleLoadCatalog();
    if (action === 'uploadModel')       return handleUploadModel(data);

    return jsonResponse({ error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ─── Doc helpers: read / write wrapper ───────────
// The Doc stores a single JSON object with optional keys: "textures", "catalog"
function readDocConfig() {
  var doc = DocumentApp.openById(DOC_ID);
  var text = doc.getBody().getText().trim();
  if (!text) return {};
  try { return JSON.parse(text); } catch (e) { return {}; }
}

function writeDocConfig(obj) {
  var doc = DocumentApp.openById(DOC_ID);
  var body = doc.getBody();
  body.clear();
  body.appendParagraph(JSON.stringify(obj, null, 2));
}

// ─── Texture actions (backward-compatible) ───────
function handleSaveTextures(data) {
  var config = readDocConfig();
  config.textures = data.config;
  writeDocConfig(config);
  return jsonResponse({ success: true, message: 'Textures saved to Doc' });
}

function handleLoadTextures() {
  var config = readDocConfig();
  if (!config.textures) {
    return jsonResponse({ success: true, config: null, message: 'No texture data in Doc' });
  }
  return jsonResponse({ success: true, config: config.textures });
}

// ─── Catalog actions ─────────────────────────────
function handleSaveCatalog(data) {
  var config = readDocConfig();
  config.catalog = data.config;
  writeDocConfig(config);
  return jsonResponse({ success: true, message: 'Catalog saved to Doc' });
}

function handleLoadCatalog() {
  var config = readDocConfig();
  if (!config.catalog) {
    return jsonResponse({ success: true, config: null, message: 'No catalog data in Doc' });
  }
  return jsonResponse({ success: true, config: config.catalog });
}

// ─── Upload texture to Drive folder ──────────────
function handleUploadTexture(data) {
  var fileName = data.fileName;
  var mimeType = data.mimeType || 'image/png';
  var base64Data = data.base64Data;

  if (!fileName || !base64Data) {
    return jsonResponse({ error: 'Missing fileName or base64Data' });
  }

  var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);

  var existing = folder.getFilesByName(fileName);
  var file;
  if (existing.hasNext()) {
    file = existing.next();
    file.setTrashed(true);
  }

  file = folder.createFile(blob);

  return jsonResponse({
    success: true,
    fileId: file.getId(),
    fileName: fileName,
    link: 'https://drive.google.com/uc?id=' + file.getId()
  });
}

// ─── Upload model to Drive subfolder ─────────────
function handleUploadModel(data) {
  var fileName = data.fileName;
  var mimeType = data.mimeType || 'application/octet-stream';
  var base64Data = data.base64Data;

  if (!fileName || !base64Data) {
    return jsonResponse({ error: 'Missing fileName or base64Data' });
  }

  var parent = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  var folders = parent.getFoldersByName(MODELS_SUBFOLDER);
  var folder = folders.hasNext() ? folders.next() : parent.createFolder(MODELS_SUBFOLDER);

  var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);

  var existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) {
    existing.next().setTrashed(true);
  }

  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return jsonResponse({
    success: true,
    fileId: file.getId(),
    fileName: fileName,
    link: 'https://drive.google.com/uc?id=' + file.getId() + '&export=download'
  });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
