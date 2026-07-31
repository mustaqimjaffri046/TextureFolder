// ─── Google Apps Script Backend ─────────────────────────
// Deploy this as a Web App (Execute as: Me, Who has access: Anyone).
// Handles: texture uploads, model uploads, catalog hierarchy JSON.
// Files stored in Cloudflare R2, config in the same Doc.
// ─────────────────────────────────────────────────────────

const DOC_ID = '1a_LBsFKrQ85H4vBpGaediOrMXNnKGH6be6bpE7sfqXE';

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

// ─── Upload texture to Cloudflare R2 ─────────────
function handleUploadTexture(data) {
  var fileName = data.fileName;
  var mimeType = data.mimeType || 'image/png';
  var base64Data = data.base64Data;

  if (!fileName || !base64Data) {
    return jsonResponse({ error: 'Missing fileName or base64Data' });
  }

  var result = uploadToR2(base64Data, fileName, mimeType);

  if (result.success) {
    return jsonResponse({
      success: true,
      r2Key: result.r2Key,
      r2Url: result.r2Url,
      fileName: fileName
    });
  } else {
    return jsonResponse({ error: result.error });
  }
}

// ─── Upload model to Cloudflare R2 ───────────────
function handleUploadModel(data) {
  var fileName = data.fileName;
  var mimeType = data.mimeType || 'application/octet-stream';
  var base64Data = data.base64Data;

  if (!fileName || !base64Data) {
    return jsonResponse({ error: 'Missing fileName or base64Data' });
  }

  var result = uploadToR2(base64Data, fileName, mimeType);

  if (result.success) {
    return jsonResponse({
      success: true,
      r2Key: result.r2Key,
      r2Url: result.r2Url,
      fileName: fileName
    });
  } else {
    return jsonResponse({ error: result.error });
  }
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
