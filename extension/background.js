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

async function generateQuestions(apiKey, payload) {
  const parts = [];
  if (payload.file && payload.file.kind === "inline") {
    parts.push({ inline_data: { mime_type: payload.file.mimeType, data: payload.file.data } });
  }
  parts.push({ text: buildUserPrompt(payload) });

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts }],
      systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: buildResponseSchema(payload.count),
        maxOutputTokens: 10000,
        thinkingConfig: { thinkingLevel: "LOW" },
      },
    }),
  });

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

  const parsed = extractJson(text);
  // 구버전(배열)과 신버전(객체) 응답 모두 허용
  const questions = Array.isArray(parsed) ? parsed : parsed.questions;
  const formTitle = Array.isArray(parsed) ? null : parsed.formTitle || null;
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("생성된 문제 형식이 올바르지 않습니다.");
  }
  return { questions, formTitle };
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

        chrome.runtime.sendMessage({ type: "MAKEFORMS_LOG", text: "AI에게 문제 생성 요청 중..." }).catch(() => {});
        const generated = await generateQuestions(geminiApiKey, message.payload);
        questions = generated.questions;
        formTitle = formTitle || generated.formTitle;
        chrome.runtime.sendMessage({
          type: "MAKEFORMS_LOG",
          text: `${questions.length}개 문제 생성 완료. 폼에 입력을 시작합니다...`,
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
