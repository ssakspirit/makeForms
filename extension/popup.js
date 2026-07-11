const topicEl = document.getElementById("topic");
const countEl = document.getElementById("count");
const difficultyEl = document.getElementById("difficulty");
const qtypeEl = document.getElementById("qtype");
const markCorrectEl = document.getElementById("markCorrect");
const generateBtn = document.getElementById("generate");
const logEl = document.getElementById("log");
const warningEl = document.getElementById("warning");

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
});

async function init() {
  const { geminiApiKey } = await chrome.storage.local.get(["geminiApiKey"]);
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
  if (!topic) {
    showWarning("주제를 입력하세요.");
    return;
  }
  warningEl.style.display = "none";
  logEl.textContent = "";
  generateBtn.disabled = true;
  generateBtn.textContent = "생성 중...";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.runtime.sendMessage({
      action: "generateAndFill",
      tabId: tab.id,
      payload: {
        topic,
        count: Math.max(1, Math.min(20, Number(countEl.value) || 5)),
        difficulty: difficultyEl.value,
        qtype: qtypeEl.value,
        markCorrect: markCorrectEl.checked,
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
