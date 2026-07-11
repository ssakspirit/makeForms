const apiKeyInput = document.getElementById("apiKey");
const statusEl = document.getElementById("status");

chrome.storage.local.get(["anthropicApiKey"], (result) => {
  if (result.anthropicApiKey) {
    apiKeyInput.value = result.anthropicApiKey;
  }
});

document.getElementById("save").addEventListener("click", () => {
  const key = apiKeyInput.value.trim();
  chrome.storage.local.set({ anthropicApiKey: key }, () => {
    statusEl.textContent = "저장되었습니다.";
    statusEl.className = "ok";
    setTimeout(() => {
      statusEl.textContent = "";
      statusEl.className = "";
    }, 2000);
  });
});
