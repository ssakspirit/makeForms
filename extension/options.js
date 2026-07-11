const apiKeyInput = document.getElementById("apiKey");
const statusEl = document.getElementById("status");

chrome.storage.sync.get(["geminiApiKey"], (result) => {
  if (result.geminiApiKey) {
    apiKeyInput.value = result.geminiApiKey;
  }
});

document.getElementById("save").addEventListener("click", () => {
  const key = apiKeyInput.value.trim();
  chrome.storage.sync.set({ geminiApiKey: key }, () => {
    statusEl.textContent = "저장되었습니다.";
    statusEl.className = "ok";
    setTimeout(() => {
      statusEl.textContent = "";
      statusEl.className = "";
    }, 2000);
  });
});
