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
    if (action === 'uploadTextures')    return handleUploadTextures(data);
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
  var existing = config.textures || {};

  var newTextures = data.config.textures || [];
  var newSizes = data.config.sizes || [];

  var oldTextures = existing.textures || [];
  var oldSizes = existing.sizes || [];

  var mergedTextures = mergeByKey(oldTextures, newTextures, function(a, b) {
    return (a.fileName || a.name) === (b.fileName || b.name);
  });

  var mergedSizes = mergeByKey(oldSizes, newSizes, function(a, b) {
    return a.sizeName === b.sizeName &&
           JSON.stringify(a.tiling) === JSON.stringify(b.tiling);
  });

  config.textures = {
    exportDate: data.config.exportDate || existing.exportDate,
    version: data.config.version || existing.version || 1,
    isFloor: data.config.isFloor !== undefined ? data.config.isFloor : (existing.isFloor !== undefined ? existing.isFloor : true),
    textures: mergedTextures,
    sizes: mergedSizes
  };

  writeDocConfig(config);
  return jsonResponse({ success: true, message: 'Textures saved to Doc (merged)' });
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
  var existing = config.catalog || {};

  var newRootNodes = data.config.rootNodes || [];
  var oldRootNodes = existing.rootNodes || [];

  var mergedRootNodes = mergeCatalogNodes(oldRootNodes, newRootNodes);

  config.catalog = {
    exportDate: data.config.exportDate || existing.exportDate,
    version: data.config.version || existing.version || 1,
    rootPanelTitle: data.config.rootPanelTitle || existing.rootPanelTitle || 'Furniture',
    rootNodes: mergedRootNodes
  };

  writeDocConfig(config);
  return jsonResponse({ success: true, message: 'Catalog saved to Doc (merged)' });
}

function handleLoadCatalog() {
  var config = readDocConfig();
  if (!config.catalog) {
    return jsonResponse({ success: true, config: null, message: 'No catalog data in Doc' });
  }
  return jsonResponse({ success: true, config: config.catalog });
}

// ─── Upload texture to Drive folder ──────────────
// ─── Upload textures to Drive folder ──────────────
function handleUploadTextures(data) {
  var textures = data.textures;
  var results = [];
  var errors = [];

  if (!Array.isArray(textures)) {
    return jsonResponse({ error: 'Expected textures array' });
  }

  var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);

  for (var i = 0; i < textures.length; i++) {
    var item = textures[i];
    var fileName = item.fileName;
    var mimeType = item.mimeType || 'image/png';
    var base64Data = item.base64Data;

    if (!fileName || !base64Data) {
      errors.push({ fileName: fileName || 'unknown', error: 'Missing fileName or base64Data' });
      continue;
    }

    try {
      var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);

      var existing = folder.getFilesByName(fileName);
      var file;
      if (existing.hasNext()) {
        file = existing.next();
        file.setTrashed(true);
      }

      file = folder.createFile(blob);

      results.push({
        success: true,
        fileId: file.getId(),
        fileName: fileName,
        link: 'https://drive.google.com/uc?id=' + file.getId()
      });

      Logger.log('Uploaded: ' + fileName + ' (' + (i + 1) + '/' + textures.length + ')');

    } catch (e) {
      Logger.log('Failed to upload ' + fileName + ': ' + e.toString());
      errors.push({ fileName: fileName, error: e.toString() });
    }
  }

  var response = {
    success: results.length > 0,
    uploaded: results,
    errors: errors
  };

  if (results.length > 0) {
    Logger.log('Batch upload complete: ' + results.length + ' uploaded, ' + errors.length + ' failed');
  }

  return jsonResponse(response);
}

// ─── Upload single texture (legacy for backward compatibility) ──────
function handleUploadTexture(data) {
  var fileName = data.fileName;
  var mimeType = data.mimeType || 'image/png';
  var base64Data = data.base64Data;

  if (!fileName || !base64Data) {
    return jsonResponse({ error: 'Missing fileName or base64Data' });
  }

  return handleUploadTextures({ textures: [{ fileName: fileName, mimeType: mimeType, base64Data: base64Data }] });
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

function testDriveAccess() {
  var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  Logger.log('Main folder: ' + folder.getName() + ' (ID: ' + folder.getId() + ')');

  var folders = folder.getFoldersByName(MODELS_SUBFOLDER);
  if (folders.hasNext()) {
    var sub = folders.next();
    Logger.log('CatalogModels subfolder exists (ID: ' + sub.getId() + ')');
    var files = sub.getFiles();
    var count = 0;
    while (files.hasNext()) { files.next(); count++; }
    Logger.log('CatalogModels has ' + count + ' file(s)');
  } else {
    Logger.log('CatalogModels subfolder does NOT exist (will be created on first upload)');
  }

  var texFiles = folder.getFiles();
  var texCount = 0;
  while (texFiles.hasNext()) { texFiles.next(); texCount++; }
  Logger.log('Main Textures folder has ' + texCount + ' file(s)');
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── Merge helpers ───────────────────────────────
function mergeByKey(oldArr, newArr, matchFn) {
  var result = oldArr.slice();
  for (var i = 0; i < newArr.length; i++) {
    var newItem = newArr[i];
    var found = false;
    for (var j = 0; j < result.length; j++) {
      if (matchFn(result[j], newItem)) {
        result[j] = newItem;
        found = true;
        break;
      }
    }
    if (!found) {
      result.push(newItem);
    }
  }
  return result;
}

function mergeCatalogNodes(oldNodes, newNodes) {
  var result = oldNodes.slice();
  for (var i = 0; i < newNodes.length; i++) {
    var newNode = newNodes[i];
    var foundIdx = -1;
    for (var j = 0; j < result.length; j++) {
      if (result[j].nodeId === newNode.nodeId) {
        foundIdx = j;
        break;
      }
    }
    if (foundIdx >= 0) {
      var merged = Object.assign({}, result[foundIdx], newNode);
      if (newNode.children && newNode.children.length > 0) {
        merged.children = mergeByKey(
          result[foundIdx].children || [],
          newNode.children,
          function(a, b) { return a.nodeId === b.nodeId; }
        );
      }
      result[foundIdx] = merged;
    } else {
      result.push(newNode);
    }
  }
  return result;
}
