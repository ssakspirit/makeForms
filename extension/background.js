const MODEL = "gemini-3.5-flash";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// minItems/maxItems로 문제 개수를 강제한다. (프롬프트만으로는 모델이 적게 만들 때가 있음)
function buildResponseSchema(count) {
  return {
    type: "OBJECT",
    properties: {
      formTitle: { type: "STRING" },
      questions: {
        type: "ARRAY",
        minItems: count,
        maxItems: count,
        items: {
          type: "OBJECT",
          properties: {
            type: { type: "STRING", enum: ["choice", "text"] },
            title: { type: "STRING" },
            options: { type: "ARRAY", items: { type: "STRING" }, minItems: 3, maxItems: 4 },
            correctIndex: { type: "INTEGER" },
            answer: { type: "STRING" },
          },
          required: ["type", "title", "correctIndex"],
        },
      },
    },
    required: ["formTitle", "questions"],
  };
}

function buildSystemPrompt() {
  return `당신은 Microsoft Forms용 퀴즈 문제를 만드는 도우미입니다.
반드시 아래 JSON 스키마를 따르는 JSON 객체만 출력하세요. 설명 문장이나 마크다운 코드펜스는 포함하지 마세요.

{
  "formTitle": "퀴즈 제목",
  "questions": [
    {
      "type": "choice",
      "title": "질문 내용",
      "options": ["보기1", "보기2", "보기3", "보기4"],
      "correctIndex": 0
    },
    {
      "type": "text",
      "title": "질문 내용",
      "answer": "모범 답안"
    }
  ]
}

- formTitle은 주제/자료에 어울리는 간결한 퀴즈 제목입니다 (예: "과학 4-1 4단원 다양한 생물 퀴즈").
- type은 "choice"(객관식) 또는 "text"(단답형) 중 하나입니다.
- choice의 options는 3~4개, correctIndex는 정답 보기의 0-based 인덱스입니다.
- 정답 보기의 위치(correctIndex)는 문항마다 무작위로 배치하세요.
- 모든 텍스트는 한국어로 작성합니다.`;
}

function buildUserPrompt(payload) {
  const typeInstruction =
    payload.qtype === "mixed"
      ? "객관식과 단답형을 섞어서 만드세요."
      : "모두 객관식(4지선다)으로 만드세요.";

  const lines = [];
  if (payload.topic) lines.push(`주제/지시사항: ${payload.topic}`);
  lines.push(`문제 개수: ${payload.count}개`);
  lines.push(`난이도: ${payload.difficulty}`);
  lines.push(typeInstruction);

  if (payload.file) {
    if (payload.file.kind === "text") {
      lines.push(`\n다음 자료의 내용을 바탕으로 문제를 출제하세요:\n"""\n${payload.file.text.slice(0, 20000)}\n"""`);
    } else {
      lines.push("\n첨부된 파일(문서)의 내용을 바탕으로 문제를 출제하세요.");
    }
  }

  return lines.join("\n");
}

function extractJson(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1] : trimmed;
  return JSON.parse(jsonText);
}

async function sendToContentScript(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    if (!/Receiving end does not exist/.test(err.message)) throw err;
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["page.js"], world: "MAIN" });
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

async function callGemini(apiKey, systemPrompt, userPrompt, schema, filePart) {
  const parts = [];
  if (filePart) {
    parts.push({ inline_data: { mime_type: filePart.mimeType, data: filePart.data } });
  }
  parts.push({ text: userPrompt });

  let res;
  let retries = 3;
  let delay = 2000;

  for (let i = 0; i < retries; i++) {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema,
          maxOutputTokens: 10000,
          thinkingConfig: { thinkingLevel: "LOW" },
        },
      }),
    });

    if (res.status === 503 || res.status === 429) {
      if (i < retries - 1) {
        chrome.runtime.sendMessage({
          type: "MAKEFORMS_LOG",
          text: `AI 서버 혼잡(${res.status}). ${delay / 1000}초 후 재시도합니다... (${i + 1}/${retries})`
        }).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
    }
    break;
  }

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini API 오류 (${res.status}): ${errBody.slice(0, 200)}`);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) throw new Error("API 응답에서 텍스트를 찾을 수 없습니다.");

  if (candidate.finishReason === "MAX_TOKENS") {
    throw new Error("응답이 토큰 한도를 초과해 중간에 잘렸습니다. 문제 개수를 줄이거나 더 작은 파일로 다시 시도하세요.");
  }

  return extractJson(text);
}

async function generateQuestions(apiKey, payload) {
  const filePart = payload.file?.kind === "inline" ? payload.file : null;
  const parsed = await callGemini(
    apiKey,
    buildSystemPrompt(),
    buildUserPrompt(payload),
    buildResponseSchema(payload.count),
    filePart
  );

  const questions = Array.isArray(parsed) ? parsed : parsed.questions;
  const formTitle = Array.isArray(parsed) ? null : parsed.formTitle || null;
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("생성된 문제 형식이 올바르지 않습니다.");
  }
  return { questions, formTitle };
}

function buildDocResponseSchema() {
  return {
    type: "OBJECT",
    properties: {
      formTitle: { type: "STRING" },
      questions: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            type: { type: "STRING", enum: ["choice", "text"] },
            title: { type: "STRING" },
            options: { type: "ARRAY", items: { type: "STRING" } },
            correctIndex: { type: "INTEGER" },
            answer: { type: "STRING" },
          },
          required: ["type", "title"],
        },
      },
    },
    required: ["formTitle", "questions"],
  };
}

function buildDocSystemPrompt() {
  return `당신은 문서를 분석하여 Microsoft Forms 양식 항목(JSON)으로 변환하는 도우미입니다.
문서의 구조와 내용을 파악하여 적절한 폼 항목 타입을 결정하세요.

지원하는 항목 타입:
- "choice": 객관식 선택 (라디오 버튼). options 배열 필수.
  - 퀴즈라면 correctIndex(0-based)로 정답 표시.
  - 설문/자가진단이면 correctIndex 없이 선택지만 제공.
- "text": 주관식/단답형 (텍스트 응답).

출력 형식:
{
  "formTitle": "양식 제목",
  "questions": [
    { "type": "choice", "title": "질문 내용", "options": ["🟢 잘함", "🟡 보통", "🔴 노력이 필요해요"] },
    { "type": "text", "title": "소감을 적어주세요" }
  ]
}

규칙:
- 리커트 척도(잘함/보통/노력 등)는 "choice"로 변환하세요.
- 주관식 소감/의견란은 "text"로 변환하세요.
- 평가표의 각 문항을 개별 질문으로 분리하세요.
- 모든 텍스트는 한국어로 작성합니다.
- 문서에 이름/날짜/학번 입력란이 있으면 "text" 타입으로 추가하세요.`;
}

function buildDocUserPrompt(payload) {
  const lines = [];
  if (payload.topic) lines.push(`추가 지시사항: ${payload.topic}`);

  if (payload.file) {
    if (payload.file.kind === "text") {
      lines.push(`\n다음 문서를 Microsoft Forms 양식으로 변환하세요:\n"""\n${payload.file.text.slice(0, 30000)}\n"""`);
    } else {
      lines.push("\n첨부된 문서를 Microsoft Forms 양식으로 변환하세요.");
    }
  }

  return lines.join("\n");
}

async function parseDocument(apiKey, payload) {
  const filePart = payload.file?.kind === "inline" ? payload.file : null;
  const parsed = await callGemini(
    apiKey,
    buildDocSystemPrompt(),
    buildDocUserPrompt(payload),
    buildDocResponseSchema(),
    filePart
  );

  const questions = parsed.questions || parsed.items || [];
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("문서에서 양식 항목을 추출하지 못했습니다.");
  }
  return { questions, formTitle: parsed.formTitle || null };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== "generateAndFill") return false;

  (async () => {
    try {
      let questions;
      let formTitle = message.payload.formTitle || null;
      if (Array.isArray(message.payload.questions)) {
        // CSV 등에서 이미 완성된 문항이 넘어온 경우: AI를 거치지 않는다.
        questions = message.payload.questions;
        chrome.runtime.sendMessage({
          type: "MAKEFORMS_LOG",
          text: `CSV에서 ${questions.length}개 문항을 읽었습니다. 폼에 입력을 시작합니다...`,
        }).catch(() => {});
      } else {
        const { geminiApiKey } = await chrome.storage.sync.get(["geminiApiKey"]);
        if (!geminiApiKey) {
          sendResponse({ ok: false, error: "API 키가 설정되지 않았습니다." });
          return;
        }

        chrome.runtime.sendMessage({
          type: "MAKEFORMS_LOG",
          text: message.payload.mode === "doc" ? "AI에게 문서 분석 요청 중..." : "AI에게 문제 생성 요청 중...",
        }).catch(() => {});

        let generated;
        if (message.payload.mode === "doc") {
          generated = await parseDocument(geminiApiKey, message.payload);
        } else {
          generated = await generateQuestions(geminiApiKey, message.payload);
        }
        questions = generated.questions;
        formTitle = formTitle || generated.formTitle;
        chrome.runtime.sendMessage({
          type: "MAKEFORMS_LOG",
          text: `${questions.length}개 항목 생성 완료. 폼에 입력을 시작합니다...`,
        }).catch(() => {});
      }

      // 팝업이 열려 있으면 페이지가 포커스를 잃어 텍스트 입력(execCommand)이
      // 동작하지 않으므로, 입력 시작 전에 팝업을 닫아 페이지에 포커스를 돌려준다.
      // 이후 진행 로그는 페이지 위에 뜨는 패널(page.js)에 표시된다.
      chrome.runtime.sendMessage({ type: "MAKEFORMS_CLOSE_POPUP" }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 400));

      const result = await sendToContentScript(message.tabId, {
        action: "insertQuestions",
        questions,
        formTitle,
        options: {
          markCorrect: message.payload.markCorrect,
          markRequired: message.payload.markRequired,
          markScore: message.payload.markScore,
        },
      });

      sendResponse({ ok: true, inserted: result.inserted, failed: result.failed });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true;
});
