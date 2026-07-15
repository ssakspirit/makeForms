const topicEl = document.getElementById("topic");
const fileInputEl = document.getElementById("sourceFile");
const fileHintEl = document.getElementById("fileHint");
const csvInputEl = document.getElementById("csvFile");
const csvHintEl = document.getElementById("csvHint");
const shuffleOptionsEl = document.getElementById("shuffleOptions");
const countEl = document.getElementById("count");
const difficultyEl = document.getElementById("difficulty");
const qtypeEl = document.getElementById("qtype");
const markCorrectEl = document.getElementById("markCorrect");
const markRequiredEl = document.getElementById("markRequired");
const markScoreEl = document.getElementById("markScore");
const generateBtn = document.getElementById("generate");
const logEl = document.getElementById("log");
const warningEl = document.getElementById("warning");
const aiSectionEl = document.getElementById("aiSection");
const csvSectionEl = document.getElementById("csvSection");

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

let hasApiKey = false;

function currentMode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function applyMode() {
  const mode = currentMode();
  aiSectionEl.style.display = mode === "ai" ? "block" : "none";
  csvSectionEl.style.display = mode === "csv" ? "block" : "none";
  generateBtn.textContent = mode === "ai" ? "AI로 문제 생성 후 자동 입력" : "CSV 문항 자동 입력";
  warningEl.style.display = "none";
  if (mode === "ai" && !hasApiKey) {
    showWarning('API 키가 없습니다. 아래 "API 키 설정"에서 등록하세요.');
  }
}

document.querySelectorAll('input[name="mode"]').forEach((el) => {
  el.addEventListener("change", applyMode);
});

// RFC 4180 스타일 CSV 파서 (따옴표 안 쉼표/줄바꿈/이중따옴표 처리, BOM 제거)
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

// Kahoot 가져오기 템플릿 형식을 문제 배열로 변환:
// Question #, Question Text, Answer 1~4, Time Limit(무시), Correct Answer(s)
function csvToQuestions(text) {
  const rows = parseCsv(text);
  const questions = [];
  const notes = [];
  for (const row of rows) {
    const title = (row[1] || "").trim();
    // 헤더 행(첫 칸이 숫자가 아님)이나 제목 없는 행은 건너뜀
    if (!title || !/^\d+$/.test((row[0] || "").trim())) continue;

    const options = row.slice(2, 6).map((o) => (o || "").trim()).filter(Boolean);
    if (options.length < 2) {
      notes.push(`${row[0]}번: 보기가 2개 미만이라 건너뜁니다.`);
      continue;
    }

    const correctNums = ((row[7] || "").match(/\d+/g) || []).map(Number);
    let correctIndex;
    if (correctNums.length > 0 && correctNums[0] >= 1 && correctNums[0] <= options.length) {
      correctIndex = correctNums[0] - 1;
    }
    if (correctNums.length > 1) {
      notes.push(`${row[0]}번: 복수 정답(${correctNums.join(",")}) 중 첫 번째만 표시합니다.`);
    }

    questions.push({ type: "choice", title, options, correctIndex });
  }
  return { questions, notes };
}

// Kahoot 템플릿은 정답이 항상 Answer 1이라 그대로 입력하면 모든 문항의
// 1번이 정답이 된다. 보기 순서를 무작위로 섞고 정답 위치를 따라간다.
function shuffleQuestionOptions(question) {
  const indices = question.options.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const shuffled = {
    ...question,
    options: indices.map((oldIdx) => question.options[oldIdx]),
  };
  if (typeof question.correctIndex === "number") {
    shuffled.correctIndex = indices.indexOf(question.correctIndex);
  }
  return shuffled;
}

fileInputEl.addEventListener("change", () => {
  const file = fileInputEl.files[0];
  if (!file) {
    fileHintEl.style.display = "none";
    return;
  }
  fileHintEl.textContent = `${file.name} (${(file.size / 1024).toFixed(0)}KB)`;
  fileHintEl.style.display = "block";
});

csvInputEl.addEventListener("change", async () => {
  const file = csvInputEl.files[0];
  if (!file) {
    csvHintEl.style.display = "none";
    return;
  }
  let hint = `${file.name} (${(file.size / 1024).toFixed(0)}KB)`;
  try {
    const { questions } = csvToQuestions(await file.text());
    hint += ` — ${questions.length}개 문항 감지`;
  } catch (e) {
    hint += " — CSV를 읽을 수 없습니다";
  }
  csvHintEl.textContent = hint;
  csvHintEl.style.display = "block";
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
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/forms\.(office|microsoft)\.com\//.test(tab.url || "")) {
    showWarning("Microsoft Forms 편집 화면(forms.office.com)이 열려 있어야 합니다.");
    generateBtn.disabled = true;
    return;
  }

  const { geminiApiKey } = await chrome.storage.sync.get(["geminiApiKey"]);
  hasApiKey = Boolean(geminiApiKey);
  applyMode();
}
init();

async function buildAiPayload() {
  const topic = topicEl.value.trim();
  const file = fileInputEl.files[0];
  if (!hasApiKey) {
    throw new Error('API 키가 설정되지 않았습니다. "API 키 설정"에서 등록하세요.');
  }
  if (!topic && !file) {
    throw new Error("주제를 입력하거나 파일을 첨부하세요.");
  }
  if (file && file.size > MAX_FILE_BYTES) {
    throw new Error(`파일이 너무 큽니다. 최대 ${MAX_FILE_BYTES / 1024 / 1024}MB까지 지원합니다.`);
  }

  const payload = {
    topic,
    count: Math.max(1, Math.min(25, Number(countEl.value) || 5)),
    difficulty: difficultyEl.value,
    qtype: qtypeEl.value,
  };
  if (file) {
    log(`파일 읽는 중: ${file.name}`);
    payload.file = await readFileAsPayload(file);
  }
  return payload;
}

async function buildCsvPayload() {
  const file = csvInputEl.files[0];
  if (!file) {
    throw new Error("CSV 파일을 선택하세요.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`파일이 너무 큽니다. 최대 ${MAX_FILE_BYTES / 1024 / 1024}MB까지 지원합니다.`);
  }

  log(`CSV 읽는 중: ${file.name}`);
  const { questions, notes } = csvToQuestions(await file.text());
  notes.forEach((n) => log(`  참고: ${n}`));
  if (questions.length === 0) {
    throw new Error("CSV에서 문항을 찾지 못했습니다. 형식을 확인하세요 (Kahoot 템플릿).");
  }

  const shuffle = shuffleOptionsEl.checked;
  return {
    questions: shuffle ? questions.map(shuffleQuestionOptions) : questions,
    // 파일명(확장자 제외)을 폼 제목으로 사용
    formTitle: file.name.replace(/\.[^.]+$/, ""),
  };
}

generateBtn.addEventListener("click", async () => {
  const mode = currentMode();
  warningEl.style.display = "none";
  logEl.textContent = "";
  generateBtn.disabled = true;
  generateBtn.textContent = mode === "ai" ? "생성 중..." : "입력 중...";

  try {
    const payload = mode === "csv" ? await buildCsvPayload() : await buildAiPayload();
    payload.markCorrect = markCorrectEl.checked;
    payload.markRequired = markRequiredEl.checked;
    payload.markScore = markScoreEl.checked;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.runtime.sendMessage({
      action: "generateAndFill",
      tabId: tab.id,
      payload,
    });
    if (response && response.ok) {
      log(`완료: ${response.inserted}개 문제 입력 (${response.failed}개 실패)`);
    } else {
      log(`오류: ${response && response.error ? response.error : "알 수 없는 오류"}`);
    }
  } catch (err) {
    showWarning(err.message);
  } finally {
    generateBtn.disabled = false;
    applyMode();
  }
});
