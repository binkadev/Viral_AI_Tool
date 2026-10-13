"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function read(file) { return fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n"); }
function write(file, content) { fs.writeFileSync(path.join(root, file), content, "utf8"); }
function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const index = source.indexOf(before);
  if (index < 0) throw new Error("Missing anchor: " + label);
  return source.slice(0, index) + after + source.slice(index + before.length);
}

let main = read("main.js");
main = replaceOnce(
  main,
  "        speechModelManager.cancelAll();\n        await waitForWorkToStop();",
  "        speechModelManager.cancelAll();\n        try { mediaDesktopController?.cancelAll(); } catch {}\n        await waitForWorkToStop();",
  "cancel media before close drain"
);
write("main.js", main);

let discovery = read("renderer/core-media-discovery.js");
discovery = replaceOnce(
  discovery,
  "  function addAcquiredAsset(rawAsset) {\n    const model = window.ViralCoreMediaLibraryModel;\n    const current = appState();\n    if (!model || !current || !rawAsset) return { status: \"invalid\" };",
  "  function addAcquiredAsset(rawAsset, expectedProjectId) {\n    const model = window.ViralCoreMediaLibraryModel;\n    const current = appState();\n    if (!model || !current || !rawAsset) return { status: \"invalid\" };\n    if (!expectedProjectId || currentProjectId() !== expectedProjectId) return { status: \"project-changed\" };",
  "bind acquired asset to originating project"
);

discovery = replaceOnce(
  discovery,
  "  function acquisitionState(result) {\n    return acquisitions.get(resultIdentity(result)) || null;\n  }",
  `  function acquisitionState(result) {\n    return acquisitions.get(resultIdentity(result)) || null;\n  }\n\n  function acquisitionErrorKey(code) {\n    const value = String(code || \"\");\n    if (value === \"MEDIA_DISK_SPACE_LOW\") return \"acquisitionDiskBody\";\n    if (value === \"MEDIA_DESTINATION_UNAVAILABLE\") return \"acquisitionDestinationBody\";\n    if (value === \"MEDIA_SOURCE_UNAVAILABLE\") return \"acquisitionSourceBody\";\n    if (value === \"MEDIA_VERIFY_FAILED\") return \"acquisitionVerifyBody\";\n    if (value === \"MEDIA_DOWNLOAD_DUPLICATE\") return \"acquisitionDuplicateBody\";\n    if (value === \"MEDIA_AUTH_REQUIRED\") return \"acquisitionAuthBody\";\n    if (value === \"MEDIA_PROJECT_CHANGED\") return \"acquisitionProjectChangedBody\";\n    return \"acquisitionDownloadBody\";\n  }`,
  "localized acquisition error mapping"
);

discovery = replaceOnce(
  discovery,
  "      const outcome = addAcquiredAsset(acquired);\n      acquisitions.delete(identity);\n      if (outcome.status === \"capacity\") {",
  "      const outcome = addAcquiredAsset(acquired, projectId);\n      if (outcome.status === \"project-changed\") {\n        acquisitions.set(identity, { ...active, state: \"failed\", error: \"MEDIA_PROJECT_CHANGED\" });\n        renderResults(lastResults);\n        return;\n      }\n      acquisitions.delete(identity);\n      if (outcome.status === \"capacity\") {",
  "project switch completion guard"
);

discovery = replaceOnce(
  discovery,
  "          (active?.state === \"failed\" ? '<em class=\"core-media-acquire-error\">' + esc(t(\"failedBody\")) + '</em>' : '') +",
  "          (active?.state === \"failed\" ? '<em class=\"core-media-acquire-error\">' + esc(t(acquisitionErrorKey(active.error))) + '</em>' : '') +",
  "actionable acquisition error copy"
);
write("renderer/core-media-discovery.js", discovery);

let i18n = read("renderer/i18n.js");
i18n = replaceOnce(
  i18n,
  'results: "Kết quả", addProject: "Thêm vào dự án", preview: "Xem nguồn", sourceBy: "Nguồn: {name}", duration: "{seconds} giây"',
  'results: "Kết quả", addProject: "Thêm vào dự án", preview: "Xem nguồn", sourceBy: "Nguồn: {name}", duration: "{seconds} giây", acquisitionDiskBody: "Không đủ dung lượng trống để thêm tư liệu này. Hãy giải phóng dung lượng hoặc chọn ổ đĩa khác rồi thử lại.", acquisitionDestinationBody: "Viral AI Tool chưa thể lưu tư liệu vào bộ nhớ dự án. Hãy kiểm tra quyền ghi hoặc vị trí lưu rồi thử lại.", acquisitionSourceBody: "Nguồn tư liệu không còn khả dụng hoặc quyền tải đã hết hạn. Hãy tìm lại tư liệu rồi thêm lần nữa.", acquisitionVerifyBody: "Tư liệu tải về không vượt qua bước kiểm tra an toàn. File chưa được thêm vào dự án; hãy thử một kết quả khác hoặc thử lại.", acquisitionDuplicateBody: "Tư liệu này đang được thêm hoặc đã có trong dự án. Không có bản sao mới được tạo.", acquisitionAuthBody: "Phiên đăng nhập cần được xác thực lại trước khi tải tư liệu. Hãy đăng nhập lại rồi thử tiếp.", acquisitionDownloadBody: "Chưa thể tải tư liệu về máy. Dự án hiện tại vẫn an toàn; hãy kiểm tra kết nối rồi thử lại.", acquisitionProjectChangedBody: "Bạn đã chuyển sang dự án khác khi tư liệu đang được tải. Tư liệu không được thêm nhầm vào dự án mới; hãy quay lại dự án ban đầu và thêm lại khi cần."',
  "Vietnamese acquisition recovery copy"
);
i18n = replaceOnce(
  i18n,
  'results: "Results", addProject: "Add to project", preview: "View source", sourceBy: "Source: {name}", duration: "{seconds} sec"',
  'results: "Results", addProject: "Add to project", preview: "View source", sourceBy: "Source: {name}", duration: "{seconds} sec", acquisitionDiskBody: "There is not enough free space to add this media. Free some space or use another drive, then try again.", acquisitionDestinationBody: "Viral AI Tool cannot save this media to the project cache. Check the writable storage location, then try again.", acquisitionSourceBody: "This media source is no longer available or its download permission expired. Search for it again, then add it once more.", acquisitionVerifyBody: "The downloaded media did not pass the safety check. It was not added to the project; try again or choose another result.", acquisitionDuplicateBody: "This media is already being added or is already in the project. No duplicate copy was created.", acquisitionAuthBody: "Your sign-in session must be verified again before downloading media. Sign in again, then retry.", acquisitionDownloadBody: "The media could not be downloaded to this device. Your project is safe; check the connection and try again.", acquisitionProjectChangedBody: "You switched projects while this media was downloading. It was not added to the new project; return to the original project and add it again if needed."',
  "English acquisition recovery copy"
);
write("renderer/i18n.js", i18n);

console.log("PR #38 review fixes applied.");
