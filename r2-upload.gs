// ─── Cloudflare R2 Upload Service ───────────────
// S3-compatible API upload using AWS Signature V4.
// ─────────────────────────────────────────────────

function generateUUID() {
  return Utilities.getUuid();
}

function getExtension(filename) {
  var i = filename.lastIndexOf('.');
  return i >= 0 ? filename.substring(i).toLowerCase() : '';
}

function toHex(byteArray) {
  var hex = '';
  for (var i = 0; i < byteArray.length; i++) {
    var b = (byteArray[i] + 256) % 256;
    hex += ('0' + b.toString(16)).slice(-2);
  }
  return hex;
}

function sha256Hex(data) {
  var bytes = typeof data === 'string'
    ? Utilities.newBlob(data).getBytes()
    : data;
  return toHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
}

function hmacSha256(key, message) {
  if (typeof key !== 'string') {
    key = Utilities.newBlob(key);
  }
  if (typeof message !== 'string') {
    message = Utilities.newBlob(message);
  }
  return Utilities.computeHmacSha256Signature(message, key);
}

function hmacSha256Hex(key, message) {
  return toHex(hmacSha256(key, message));
}

function getSignatureKey(secretKey, dateStamp, region, service) {
  var kDate    = hmacSha256('AWS4' + secretKey, dateStamp);
  var kRegion  = hmacSha256(kDate, region);
  var kService = hmacSha256(kRegion, service);
  var kSigning = hmacSha256(kService, 'aws4_request');
  return kSigning;
}

// ─── Upload a file to Cloudflare R2 ─────────────
function uploadToR2(base64Data, fileName, mimeType, objectKey) {
  var config = getR2Config();

  // Generate unique object key if not provided
  if (!objectKey) {
    objectKey = generateUUID() + getExtension(fileName);
  }

  var bodyBytes    = Utilities.base64Decode(base64Data);
  var payloadHash  = sha256Hex(bodyBytes);
  var contentType  = mimeType || 'application/octet-stream';

  var d = new Date();
  var y = d.getUTCFullYear();
  var mo = ('0' + (d.getUTCMonth() + 1)).slice(-2);
  var dd = ('0' + d.getUTCDate()).slice(-2);
  var hh = ('0' + d.getUTCHours()).slice(-2);
  var mi = ('0' + d.getUTCMinutes()).slice(-2);
  var ss = ('0' + d.getUTCSeconds()).slice(-2);
  var amzDate = y + mo + dd + 'T' + hh + mi + ss + 'Z';
  var dateStamp = y + mo + dd;

  var host = config.accountId + '.r2.cloudflarestorage.com';
  var uri  = '/' + config.bucketName + '/' + encodeURIComponent(objectKey);

  // ── AWS Signature V4 ──────────────────────────
  var canonicalHeaders =
    'content-type:' + contentType + '\n' +
    'host:' + host + '\n' +
    'x-amz-content-sha256:' + payloadHash + '\n' +
    'x-amz-date:' + amzDate + '\n';
  var signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  var canonicalRequest =
    'PUT\n' + uri + '\n\n' +
    canonicalHeaders + '\n' +
    signedHeaders + '\n' +
    payloadHash;
  var canonicalRequestHash = sha256Hex(canonicalRequest);

  var credentialScope = dateStamp + '/' + config.region + '/s3/aws4_request';
  var stringToSign =
    'AWS4-HMAC-SHA256\n' +
    amzDate + '\n' +
    credentialScope + '\n' +
    canonicalRequestHash;

  var signingKey = getSignatureKey(config.secretAccessKey, dateStamp, config.region, 's3');
  var signature  = hmacSha256Hex(signingKey, stringToSign);

  var authorization =
    'AWS4-HMAC-SHA256 ' +
    'Credential=' + config.accessKeyId + '/' + credentialScope + ', ' +
    'SignedHeaders=' + signedHeaders + ', ' +
    'Signature=' + signature;

  var url = 'https://' + host + uri;

  var options = {
    method: 'put',
    headers: {
      'Content-Type':         contentType,
      'Host':                 host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date':           amzDate,
      'Authorization':        authorization
    },
    payload: bodyBytes,
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var statusCode = response.getResponseCode();

    if (statusCode >= 200 && statusCode < 300) {
      return {
        success: true,
        r2Key:   objectKey,
        r2Url:   config.publicUrl.replace(/\/+$/, '') + '/' + encodeURIComponent(objectKey),
        fileName: fileName
      };
    } else {
      var errorBody = response.getContentText();
      return {
        success: false,
        error: 'R2 upload failed (' + statusCode + '): ' + errorBody.substring(0, 500)
      };
    }
  } catch (err) {
    return {
      success: false,
      error: 'R2 upload error: ' + err.message
    };
  }
}

// ─── Delete a file from Cloudflare R2 ───────────
function deleteFromR2(objectKey) {
  var config = getR2Config();

  var d = new Date();
  var y = d.getUTCFullYear();
  var mo = ('0' + (d.getUTCMonth() + 1)).slice(-2);
  var dd = ('0' + d.getUTCDate()).slice(-2);
  var hh = ('0' + d.getUTCHours()).slice(-2);
  var mi = ('0' + d.getUTCMinutes()).slice(-2);
  var ss = ('0' + d.getUTCSeconds()).slice(-2);
  var amzDate = y + mo + dd + 'T' + hh + mi + ss + 'Z';
  var dateStamp = y + mo + dd;

  var host = config.accountId + '.r2.cloudflarestorage.com';
  var uri  = '/' + config.bucketName + '/' + encodeURIComponent(objectKey);

  var canonicalHeaders =
    'host:' + host + '\n' +
    'x-amz-content-sha256:UNSIGNED-PAYLOAD\n' +
    'x-amz-date:' + amzDate + '\n';
  var signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  var canonicalRequest =
    'DELETE\n' + uri + '\n\n' +
    canonicalHeaders + '\n' +
    signedHeaders + '\n' +
    'UNSIGNED-PAYLOAD';
  var canonicalRequestHash = sha256Hex(canonicalRequest);

  var credentialScope = dateStamp + '/' + config.region + '/s3/aws4_request';
  var stringToSign =
    'AWS4-HMAC-SHA256\n' +
    amzDate + '\n' +
    credentialScope + '\n' +
    canonicalRequestHash;

  var signingKey = getSignatureKey(config.secretAccessKey, dateStamp, config.region, 's3');
  var signature  = hmacSha256Hex(signingKey, stringToSign);

  var authorization =
    'AWS4-HMAC-SHA256 ' +
    'Credential=' + config.accessKeyId + '/' + credentialScope + ', ' +
    'SignedHeaders=' + signedHeaders + ', ' +
    'Signature=' + signature;

  var url = 'https://' + host + uri;

  var options = {
    method: 'delete',
    headers: {
      'Host':                 host,
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      'x-amz-date':           amzDate,
      'Authorization':        authorization
    },
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var statusCode = response.getResponseCode();

    if (statusCode >= 200 && statusCode < 300) {
      return { success: true, r2Key: objectKey };
    } else {
      return { success: false, error: 'R2 delete failed (' + statusCode + ')' };
    }
  } catch (err) {
    return { success: false, error: 'R2 delete error: ' + err.message };
  }
}
