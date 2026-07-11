// Microsoft Forms 편집 화면 DOM 자동화.
// MS Forms UI가 업데이트되면 아래 텍스트 패턴만 손보면 되도록 매칭 로직을 한 곳에 모아둠.
const PATTERNS = {
  addQuestion: [/새\s*질문\s*추가/, /질문\s*추가/, /add\s*new\s*question/i, /^add\s*question/i],
  addOption: [/옵션\s*추가/, /선택항목\s*추가/, /add\s*option/i],
  questionTitle: [/질문/, /question/i],
  option: [/옵션/, /선택항목/, /option/i],
  markCorrect: [/정답으로\s*표시/, /정답/, /mark\s*as\s*correct/i, /correct\s*answer/i],
};

function matchesAny(text, patterns) {
  return patterns.some((p) => p.test(text));
}

function accessibleName(el) {
  return (el.getAttribute("aria-label") || el.textContent || "").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, { timeout = 4000, interval = 150 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = fn();
    if (result) return result;
    await sleep(interval);
  }
  return null;
}

function findClickable(patterns, root = document) {
  const candidates = Array.from(root.querySelectorAll('button, [role="button"], a'));
  return candidates.find((el) => matchesAny(accessibleName(el), patterns));
}

function getAllTextboxes() {
  return Array.from(document.querySelectorAll('[role="textbox"]'));
}

function getQuestionTitleFields() {
  return getAllTextboxes().filter((el) => {
    const name = accessibleName(el).toLowerCase();
    return matchesAny(name, PATTERNS.questionTitle) && !matchesAny(name, PATTERNS.option);
  });
}

function setNativeInputValue(el, text) {
  const tag = el.tagName.toLowerCase();
  const proto = tag === "textarea" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(el, text);
  } else {
    el.value = text;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function setEditableText(el, text) {
  el.focus();
  try {
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, text);
  } catch (e) {
    el.textContent = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.blur();
}

function fillField(el, text) {
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea") {
    setNativeInputValue(el, text);
  } else {
    setEditableText(el, text);
  }
}

function log(text) {
  chrome.runtime.sendMessage({ type: "MAKEFORMS_LOG", text });
}

async function clickAddQuestionButton() {
  const btn = await waitFor(() => findClickable(PATTERNS.addQuestion));
  if (!btn) throw new Error('"새 질문 추가" 버튼을 찾을 수 없습니다.');
  btn.click();
}

async function waitForNewTitleField(previousCount) {
  return waitFor(() => {
    const fields = getQuestionTitleFields();
    return fields.length > previousCount ? fields[fields.length - 1] : null;
  });
}

function getOptionFieldsForCard(titleEl) {
  const allTitleEls = getQuestionTitleFields();
  const allTextboxes = getAllTextboxes();
  const titleIndex = allTextboxes.indexOf(titleEl);
  const nextTitleIndex = allTextboxes.findIndex((el, i) => i > titleIndex && allTitleEls.includes(el));
  const end = nextTitleIndex === -1 ? allTextboxes.length : nextTitleIndex;
  return allTextboxes.slice(titleIndex + 1, end).filter((el) => matchesAny(accessibleName(el).toLowerCase(), PATTERNS.option));
}

function getAddOptionButton(titleEl) {
  const allTitleEls = getQuestionTitleFields();
  const allClickable = Array.from(document.querySelectorAll('button, [role="button"], a'));
  const titleRect = titleEl.getBoundingClientRect();
  const nextTitleEl = allTitleEls.find((el) => {
    const r = el.getBoundingClientRect();
    return r.top > titleRect.top;
  });
  const lowerBound = nextTitleEl ? nextTitleEl.getBoundingClientRect().top : Infinity;
  return allClickable.find((el) => {
    if (!matchesAny(accessibleName(el), PATTERNS.addOption)) return false;
    const r = el.getBoundingClientRect();
    return r.top >= titleRect.top && r.top < lowerBound;
  });
}

async function ensureOptionCount(titleEl, count) {
  let options = getOptionFieldsForCard(titleEl);
  let guard = 0;
  while (options.length < count && guard < count + 2) {
    const addBtn = getAddOptionButton(titleEl);
    if (!addBtn) break;
    addBtn.click();
    await sleep(300);
    options = getOptionFieldsForCard(titleEl);
    guard++;
  }
  return options;
}

function markOptionCorrect(optionEl) {
  let ancestor = optionEl.parentElement;
  for (let i = 0; i < 4 && ancestor; i++) {
    const btn = findClickable(PATTERNS.markCorrect, ancestor);
    if (btn) {
      btn.click();
      return true;
    }
    ancestor = ancestor.parentElement;
  }
  return false;
}

async function insertChoiceQuestion(question, opts) {
  const before = getQuestionTitleFields().length;
  await clickAddQuestionButton();
  const titleEl = await waitForNewTitleField(before);
  if (!titleEl) throw new Error("새 질문 카드를 찾지 못했습니다.");
  await sleep(200);

  fillField(titleEl, question.title);
  await sleep(150);

  const options = question.options || [];
  const fields = await ensureOptionCount(titleEl, options.length);
  if (fields.length < options.length) {
    log(`  경고: "${question.title}" 옵션 입력란을 ${options.length}개 중 ${fields.length}개만 찾았습니다.`);
  }

  for (let i = 0; i < Math.min(fields.length, options.length); i++) {
    fillField(fields[i], options[i]);
    await sleep(120);
  }

  if (opts.markCorrect && typeof question.correctIndex === "number" && fields[question.correctIndex]) {
    const ok = markOptionCorrect(fields[question.correctIndex]);
    if (!ok) {
      log(`  참고: "${question.title}"는 퀴즈 모드가 아니거나 정답 표시 버튼을 찾지 못해 건너뛰었습니다.`);
    }
  }
}

async function insertTextQuestion(question) {
  // 단답형은 기본으로 추가되는 객관식 카드를 텍스트 타입으로 전환해야 하므로
  // 타입 전환 UI를 찾지 못하면 제목만 채운 객관식 카드로 남는다(실험적 기능, README 참고).
  const before = getQuestionTitleFields().length;
  await clickAddQuestionButton();
  const titleEl = await waitForNewTitleField(before);
  if (!titleEl) throw new Error("새 질문 카드를 찾지 못했습니다.");
  await sleep(200);
  fillField(titleEl, question.title);
  log(`  참고: "${question.title}"는 단답형으로 자동 전환하지 못해 기본 유형으로 추가되었습니다. 수동으로 유형을 변경해주세요.`);
}

async function insertQuestions(questions, opts) {
  let inserted = 0;
  let failed = 0;
  for (const q of questions) {
    try {
      log(`문제 입력 중: "${q.title}"`);
      if (q.type === "text") {
        await insertTextQuestion(q);
      } else {
        await insertChoiceQuestion(q, opts);
      }
      inserted++;
      await sleep(300);
    } catch (err) {
      failed++;
      log(`  실패: "${q.title}" - ${err.message}`);
    }
  }
  return { inserted, failed };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== "insertQuestions") return false;
  insertQuestions(message.questions, message.options || {}).then(sendResponse);
  return true;
});
