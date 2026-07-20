const apiKeyInput = document.getElementById("apiKey");
const apiKeyBackupInput = document.getElementById("apiKeyBackup");
const statusEl = document.getElementById("status");

chrome.storage.sync.get(["geminiApiKey", "geminiApiKeyBackup"], (result) => {
  if (result.geminiApiKey) {
    apiKeyInput.value = result.geminiApiKey;
  }
  if (result.geminiApiKeyBackup) {
    apiKeyBackupInput.value = result.geminiApiKeyBackup;
  }
});

document.getElementById("save").addEventListener("click", () => {
  const key = apiKeyInput.value.trim();
  const backupKey = apiKeyBackupInput.value.trim();
  chrome.storage.sync.set({ geminiApiKey: key, geminiApiKeyBackup: backupKey }, () => {
    statusEl.textContent = "저장되었습니다.";
    statusEl.className = "ok";
    setTimeout(() => {
      statusEl.textContent = "";
      statusEl.className = "";
    }, 2000);
  });
});
