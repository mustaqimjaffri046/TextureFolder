// ─── Google Apps Script Backend ─────────────────────────
// Deploy this as a Web App (Execute as: Me, Who has access: Anyone).
// It handles Drive uploads and Doc read/write for the Floor Material Setup page.
// ─────────────────────────────────────────────────────────

const DRIVE_FOLDER_ID = '1hXJn3iztH2h7ut0S4rqxGCT2xp4RO6ES';
const DOC_ID = '1a_LBsFKrQ85H4vBpGaediOrMXNnKGH6be6bpE7sfqXE';

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    if (action === 'save') return handleSave(data);
    if (action === 'load') return handleLoad();
    if (action === 'uploadTexture') return handleUploadTexture(data);

    return jsonResponse({ error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ─── Save: write config to Doc ─────────────────
function handleSave(data) {
  const config = data.config;

  const doc = DocumentApp.openById(DOC_ID);
  const body = doc.getBody();
  body.clear();
  body.appendParagraph(JSON.stringify(config, null, 2));

  return jsonResponse({ success: true, message: 'Config saved to Doc' });
}

// ─── Load: read config from Doc ────────────────
function handleLoad() {
  const doc = DocumentApp.openById(DOC_ID);
  const body = doc.getBody();
  const text = body.getText().trim();

  if (!text) {
    return jsonResponse({ success: true, config: null, message: 'Doc is empty' });
  }

  try {
    const config = JSON.parse(text);
    return jsonResponse({ success: true, config: config });
  } catch (err) {
    return jsonResponse({ success: false, error: 'Invalid JSON in Doc: ' + err.message });
  }
}

// ─── Upload texture to Drive folder ────────────
function handleUploadTexture(data) {
  var fileName = data.fileName;
  var mimeType = data.mimeType || 'image/png';
  var base64Data = data.base64Data;

  if (!fileName || !base64Data) {
    return jsonResponse({ error: 'Missing fileName or base64Data' });
  }

  var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);

  // Check if file already exists — delete and recreate ( Drive has no direct update for blobs )
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

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
