// lib/asset-utils.js

function cleanString(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

export function isValidHttpUrl(value) {
  const url = cleanString(value);

  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);

    return (
      parsed.protocol === "https:" ||
      parsed.protocol === "http:"
    );
  } catch {
    return false;
  }
}

export function getFileExtension(
  filename = ""
) {
  const value = cleanString(filename);

  const match = value.match(
    /\.([a-zA-Z0-9]+)(?:\?.*)?$/
  );

  return match
    ? match[1].toLowerCase()
    : "";
}

export function getMimeTypeFromExtension(
  extension = ""
) {
  const ext = cleanString(extension)
    .replace(".", "")
    .toLowerCase();

  const mimeTypes = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    svg: "image/svg+xml",

    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    aac: "audio/aac",
    ogg: "audio/ogg",

    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
  };

  return (
    mimeTypes[ext] ||
    "application/octet-stream"
  );
}

export function getMimeTypeFromUrl(
  url = ""
) {
  const extension =
    getFileExtension(url);

  return getMimeTypeFromExtension(
    extension
  );
}

export function getAssetType(
  mimeType = "",
  url = ""
) {
  const mime = cleanString(mimeType)
    .toLowerCase();

  if (mime.startsWith("image/")) {
    return "image";
  }

  if (mime.startsWith("audio/")) {
    return "audio";
  }

  if (mime.startsWith("video/")) {
    return "video";
  }

  const extension =
    getFileExtension(url);

  if (
    [
      "jpg",
      "jpeg",
      "png",
      "webp",
      "gif",
      "svg",
    ].includes(extension)
  ) {
    return "image";
  }

  if (
    [
      "mp3",
      "wav",
      "m4a",
      "aac",
      "ogg",
    ].includes(extension)
  ) {
    return "audio";
  }

  if (
    [
      "mp4",
      "webm",
      "mov",
    ].includes(extension)
  ) {
    return "video";
  }

  return "unknown";
}

export function normalizeAsset(
  asset = {},
  fallbackType = "unknown"
) {
  if (typeof asset === "string") {
    const url = cleanString(asset);

    return {
      url,
      type:
        getAssetType("", url) ||
        fallbackType,
      mimeType:
        getMimeTypeFromUrl(url),
      filename: "",
    };
  }

  if (!asset || typeof asset !== "object") {
    return {
      url: "",
      type: fallbackType,
      mimeType: "",
      filename: "",
    };
  }

  const url = cleanString(
    asset.url ||
      asset.src ||
      asset.uri
  );

  const mimeType = cleanString(
    asset.mimeType ||
      asset.contentType ||
      ""
  );

  const filename = cleanString(
    asset.filename ||
      asset.fileName ||
      ""
  );

  const type =
    cleanString(asset.type) ||
    getAssetType(
      mimeType,
      url
    ) ||
    fallbackType;

  return {
    url,
    type,
    mimeType:
      mimeType ||
      getMimeTypeFromUrl(
        url || filename
      ),
    filename,
  };
}

export function normalizeAssets(
  assets = [],
  fallbackType = "unknown"
) {
  if (!Array.isArray(assets)) {
    return [];
  }

  return assets
    .map((asset) =>
      normalizeAsset(
        asset,
        fallbackType
      )
    )
    .filter(
      (asset) =>
        asset.url ||
        asset.filename
    );
}

export function createAssetId(
  type = "asset",
  index = 0
) {
  const safeType =
    cleanString(type)
      .toLowerCase()
      .replace(
        /[^a-z0-9_-]/g,
        "-"
      ) || "asset";

  const safeIndex =
    Math.max(
      0,
      Number(index) || 0
    );

  return `${safeType}_${safeIndex + 1}`;
}

export function buildAssetPath({
  folder = "assets",
  jobId = "",
  filename = "",
} = {}) {
  const safeFolder =
    cleanString(folder)
      .replace(/^\/+|\/+$/g, "");

  const safeJobId =
    cleanString(jobId)
      .replace(
        /[^a-zA-Z0-9_-]/g,
        "_"
      );

  const safeFilename =
    cleanString(filename)
      .replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
      );

  const parts = [
    safeFolder,
    safeJobId,
    safeFilename,
  ].filter(Boolean);

  return parts.join("/");
}

export function validateAsset(
  asset = {},
  {
    allowedTypes = [],
    requireUrl = true,
  } = {}
) {
  const normalized =
    normalizeAsset(asset);

  if (
    requireUrl &&
    !isValidHttpUrl(
      normalized.url
    )
  ) {
    return {
      valid: false,
      asset: normalized,
      reason:
        "Asset URL is missing or invalid.",
    };
  }

  if (
    allowedTypes.length > 0 &&
    !allowedTypes.includes(
      normalized.type
    )
  ) {
    return {
      valid: false,
      asset: normalized,
      reason:
        "Asset type is not allowed.",
    };
  }

  return {
    valid: true,
    asset: normalized,
    reason: "",
  };
}

export function validateAssets(
  assets = [],
  options = {}
) {
  const normalized =
    normalizeAssets(assets);

  const results =
    normalized.map((asset) =>
      validateAsset(
        asset,
        options
      )
    );

  return {
    valid: results.every(
      (result) => result.valid
    ),
    assets: results.map(
      (result) => result.asset
    ),
    errors: results
      .filter(
        (result) => !result.valid
      )
      .map(
        (result) => result.reason
      ),
  };
}
