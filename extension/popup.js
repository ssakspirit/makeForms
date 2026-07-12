const topicEl = document.getElementById("topic");
const fileInputEl = document.getElementById("sourceFile");
const fileHintEl = document.getElementById("fileHint");
const countEl = document.getElementById("count");
const difficultyEl = document.getElementById("difficulty");
const qtypeEl = document.getElementById("qtype");
const markCorrectEl = document.getElementById("markCorrect");
const markRequiredEl = document.getElementById("markRequired");
const generateBtn = document.getElementById("generate");
const logEl = document.getElementById("log");
const warningEl = document.getElementById("warning");

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

fileInputEl.addEventListener("change", () => {
  const file = fileInputEl.files[0];
  if (!file) {
    fileHintEl.style.display = "none";
    return;
  }
  fileHintEl.textContent = `${file.name} (${(file.size / 1024).toFixed(0)}KB)`;
  fileHintEl.style.display = "block";
});

async function readFileAsPayload(file) {
  const isText = /\.(txt|md)$/i.test(file.name) || file.type.startsWith("text/");
  if (isText) {
    return { kind: "text", text: await file.text() };
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("파일을 읽을 수 없습니다."));
    reader.readAsDataURL(file);
  });
  const base64 = String(dataUrl).split(",")[1] || "";
  return { kind: "inline", mimeType: file.type || "application/pdf", data: base64 };
}

document.getElementById("openOptions").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

function log(text) {
  logEl.style.display = "block";
  logEl.textContent += text + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

function showWarning(text) {
  warningEl.textContent = text;
  warningEl.style.display = "block";
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "MAKEFORMS_LOG") {
    log(msg.text);
  }
  // 입력 단계에서는 페이지가 포커스를 가져야 하므로 팝업을 닫는다.
  // 이후 진행 로그는 Forms 페이지 위 패널에 표시된다.
  if (msg.type === "MAKEFORMS_CLOSE_POPUP") {
    window.close();
  }
});

async function init() {
  const { geminiApiKey } = await chrome.storage.sync.get(["geminiApiKey"]);
  if (!geminiApiKey) {
    showWarning('API 키가 설정되지 않았습니다. 아래 "API 키 설정"을 눌러 먼저 등록하세요.');
    generateBtn.disabled = true;
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/forms\.(office|microsoft)\.com\//.test(tab.url || "")) {
    showWarning("Microsoft Forms 편집 화면(forms.office.com)이 열려 있어야 합니다.");
    generateBtn.disabled = true;
  }
}
init();

generateBtn.addEventListener("click", async () => {
  const topic = topicEl.value.trim();
  const file = fileInputEl.files[0];
  if (!topic && !file) {
    showWarning("주제를 입력하거나 파일을 첨부하세요.");
    return;
  }
  if (file && file.size > MAX_FILE_BYTES) {
    showWarning(`파일이 너무 큽니다. 최대 ${MAX_FILE_BYTES / 1024 / 1024}MB까지 지원합니다.`);
    return;
  }
  warningEl.style.display = "none";
  logEl.textContent = "";
  generateBtn.disabled = true;
  generateBtn.textContent = "생성 중...";

  try {
    let filePayload = null;
    if (file) {
      log(`파일 읽는 중: ${file.name}`);
      filePayload = await readFileAsPayload(file);
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.runtime.sendMessage({
      action: "generateAndFill",
      tabId: tab.id,
      payload: {
        topic,
        file: filePayload,
        count: Math.max(1, Math.min(20, Number(countEl.value) || 5)),
        difficulty: difficultyEl.value,
        qtype: qtypeEl.value,
        markCorrect: markCorrectEl.checked,
        markRequired: markRequiredEl.checked,
      },
    });
    if (response && response.ok) {
      log(`완료: ${response.inserted}개 문제 입력 (${response.failed}개 실패)`);
    } else {
      log(`오류: ${response && response.error ? response.error : "알 수 없는 오류"}`);
    }
  } catch (err) {
    log(`오류: ${err.message}`);
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = "AI로 문제 생성 후 자동 입력";
  }
});
