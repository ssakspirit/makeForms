const MODEL = "gemini-2.5-flash";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

function buildSystemPrompt() {
  return `당신은 Microsoft Forms용 퀴즈 문제를 만드는 도우미입니다.
반드시 아래 JSON 스키마를 따르는 JSON 배열만 출력하세요. 설명 문장이나 마크다운 코드펜스는 포함하지 마세요.

[
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

- type은 "choice"(객관식) 또는 "text"(단답형) 중 하나입니다.
- choice의 options는 3~4개, correctIndex는 정답 보기의 0-based 인덱스입니다.
- 모든 텍스트는 한국어로 작성합니다.`;
}

function buildUserPrompt(payload) {
  const typeInstruction =
    payload.qtype === "mixed"
      ? "객관식과 단답형을 섞어서 만드세요."
      : "모두 객관식(4지선다)으로 만드세요.";
  return `주제: ${payload.topic}
문제 개수: ${payload.count}개
난이도: ${payload.difficulty}
${typeInstruction}`;
}

function extractJson(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1] : trimmed;
  return JSON.parse(jsonText);
}

async function generateQuestions(apiKey, payload) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildUserPrompt(payload) }] }],
      systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
      generationConfig: { responseMimeType: "application/json" },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini API 오류 (${res.status}): ${errBody.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("API 응답에서 텍스트를 찾을 수 없습니다.");

  const questions = extractJson(text);
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("생성된 문제 형식이 올바르지 않습니다.");
  }
  return questions;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== "generateAndFill") return false;

  (async () => {
    try {
      const { geminiApiKey } = await chrome.storage.sync.get(["geminiApiKey"]);
      if (!geminiApiKey) {
        sendResponse({ ok: false, error: "API 키가 설정되지 않았습니다." });
        return;
      }

      chrome.runtime.sendMessage({ type: "MAKEFORMS_LOG", text: "AI에게 문제 생성 요청 중..." });
      const questions = await generateQuestions(geminiApiKey, message.payload);
      chrome.runtime.sendMessage({
        type: "MAKEFORMS_LOG",
        text: `${questions.length}개 문제 생성 완료. 폼에 입력을 시작합니다...`,
      });

      const result = await chrome.tabs.sendMessage(message.tabId, {
        action: "insertQuestions",
        questions,
        options: { markCorrect: message.payload.markCorrect },
      });

      sendResponse({ ok: true, inserted: result.inserted, failed: result.failed });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true;
});
