// Microsoft Forms 편집 화면 DOM 자동화 본체 (페이지 MAIN world에서 실행).
// 확장 격리 월드에서는 execCommand 기반 텍스트 입력이 Forms 내부 상태(React)에
// 반영되지 않아 카드가 접힐 때 내용이 사라지는 문제가 있다. 그래서 자동화는
// 페이지 월드에서 실행하고, content.js(격리 월드)와는 window.postMessage로 통신한다.
// MS Forms UI가 업데이트되면 아래 텍스트 패턴만 손보면 되도록 매칭 로직을 한 곳에 모아둠.
(() => {
  if (window.__makeFormsInjected) return;
  window.__makeFormsInjected = true;

  const PATTERNS = {
    addQuestion: [/새\s*질문\s*추가/, /질문\s*추가/, /add\s*new\s*question/i, /^add\s*question/i],
    addOption: [/옵션\s*추가/, /선택항목\s*추가/, /add\s*option/i],
    questionTitle: [/질문/, /question/i],
    option: [/옵션/, /선택항목/, /option/i],
    markCorrect: [/정답으로\s*표시/, /정답/, /mark\s*as\s*correct/i, /correct\s*answer/i],
    // "새 질문 추가" 클릭 시 뜨는 유형 선택 패널(선택 항목/텍스트/평가/...)의 항목들.
    typeChoice: [/^선택\s*항목$/, /^choice$/i],
    typeText: [/^텍스트$/, /^text$/i],
    required: [/^필수$/, /^required$/i],
    // 폼 제목 컨테이너를 클릭하면 열리는 편집기의 textbox (aria-label이 정확히 "양식 제목")
    formTitleBox: [/^양식\s*제목$/, /^form\s*title$/i],
  };

  // data-automation-id는 Fluent UI가 UI 문구/언어와 무관하게 붙이는 안정적인 식별자라
  // aria-label 텍스트 매칭보다 우선 사용한다. MS Forms UI가 바뀌면 여기부터 확인.
  const AUTOMATION_IDS = {
    addQuestion: ["questionAdd"],
    formTitle: ["formTitleContainer"],
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

  function findByAutomationId(automationIds, root = document) {
    for (const id of automationIds) {
      const el = root.querySelector(`[data-automation-id="${id}"]`);
      if (el) return el;
    }
    return null;
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

  function normalizeText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  // Forms의 입력란은 RoosterJS 에디터(contenteditable)라 클릭으로 활성화한 뒤
  // execCommand로 입력해야 내부 상태까지 반영된다. 입력 후 실제 반영 여부를
  // 확인하고 안 됐으면 재시도한다.
  async function setEditableText(el, text) {
    for (let attempt = 0; attempt < 3; attempt++) {
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      el.click();
      await sleep(150);
      el.focus();
      try {
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, text);
      } catch (e) {
        // 아래 검증에서 실패로 잡혀 재시도된다.
      }
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.blur();
      if (normalizeText(el.textContent) === normalizeText(text)) {
        return true;
      }
      await sleep(250);
    }
    return false;
  }

  async function fillField(el, text) {
    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea") {
      setNativeInputValue(el, text);
      return true;
    }
    return setEditableText(el, text);
  }

  // 입력 단계에서는 팝업이 닫혀 있으므로(포커스 문제) 진행 로그를
  // 페이지 위에 떠 있는 패널에 표시한다.
  let panelBody = null;
  function ensurePanel() {
    if (panelBody && panelBody.isConnected) return panelBody;
    const panel = document.createElement("div");
    panel.style.cssText =
      "position:fixed;top:70px;right:16px;width:320px;max-height:50vh;z-index:2147483647;" +
      "background:#1f1f2e;color:#eee;font:12px/1.6 'Segoe UI',sans-serif;border-radius:10px;" +
      "box-shadow:0 4px 16px rgba(0,0,0,.35);display:flex;flex-direction:column;";
    const head = document.createElement("div");
    head.style.cssText =
      "display:flex;justify-content:space-between;align-items:center;padding:8px 12px;" +
      "font-weight:600;border-bottom:1px solid #444;";
    const title = document.createElement("span");
    title.textContent = "makeForms 진행 상황";
    const close = document.createElement("button");
    close.textContent = "✕";
    close.style.cssText = "background:none;border:none;color:#aaa;cursor:pointer;font-size:13px;";
    close.addEventListener("click", () => panel.remove());
    head.append(title, close);
    const body = document.createElement("div");
    body.style.cssText = "padding:8px 12px;overflow-y:auto;white-space:pre-wrap;";
    panel.append(head, body);
    document.body.appendChild(panel);
    panelBody = body;
    return body;
  }

  function log(text) {
    window.postMessage({ source: "makeforms", type: "LOG", text }, "*");
    const body = ensurePanel();
    body.textContent += text + "\n";
    body.scrollTop = body.scrollHeight;
  }

  async function clickAddQuestionButton() {
    const btn = await waitFor(() => findByAutomationId(AUTOMATION_IDS.addQuestion) || findClickable(PATTERNS.addQuestion));
    if (!btn) throw new Error('"새 질문 추가" 버튼을 찾을 수 없습니다.');
    // 폼이 길어질수록 버튼이 화면 밖에 있을 수 있어, 위치 기반으로 뜨는
    // 유형 선택 패널이 제대로 나타나도록 클릭 전에 화면 중앙으로 스크롤한다.
    btn.scrollIntoView({ block: "center" });
    await sleep(100);
    btn.click();
  }

  // "새 질문 추가" 클릭 시 유형 선택 패널(선택 항목/텍스트/평가/...)이 뜨므로,
  // 원하는 유형 항목을 한 번 더 클릭해야 실제 질문 카드가 생성된다.
  // 첫 클릭 직후엔 패널 렌더링 타이밍 때문에 유형 버튼을 못 찾을 때가 있어,
  // 그 경우 "새 질문 추가"부터 한 번 더 시도한다.
  async function openQuestionTypePanel(patterns, label) {
    for (let attempt = 0; attempt < 2; attempt++) {
      await clickAddQuestionButton();
      const btn = await waitFor(() => findClickable(patterns), { timeout: 2500 });
      if (btn) {
        btn.click();
        return;
      }
    }
    throw new Error(`"${label}" 유형 버튼을 찾을 수 없습니다.`);
  }

  // Forms는 편집 중이 아닌 질문 카드를 접어서 textbox가 사라지므로,
  // 개수 비교 대신 "이전에 없던 새 textbox 요소"를 찾는다.
  // (직전 카드가 접히면서 개수는 그대로일 수 있음)
  async function waitForNewTitleField(previousFields) {
    return waitFor(() => {
      return getQuestionTitleFields().find((el) => !previousFields.has(el)) || null;
    });
  }

  // 유형 클릭까지는 성공했는데 카드 렌더링이 반영되지 않는 경우가 있어,
  // 전체 흐름(추가 버튼 -> 유형 선택 -> 카드 대기)을 통째로 한 번 더 재시도한다.
  async function addQuestionCard(typePatterns, typeLabel) {
    const previousFields = new Set(getQuestionTitleFields());
    for (let attempt = 0; attempt < 2; attempt++) {
      await openQuestionTypePanel(typePatterns, typeLabel);
      const titleEl = await waitForNewTitleField(previousFields);
      if (titleEl) return titleEl;
    }
    throw new Error("새 질문 카드를 찾지 못했습니다.");
  }

  // 텍스트를 입력하면 Forms(React)가 해당 부분을 다시 렌더링해 기존 요소가
  // 문서에서 분리(detached)될 수 있다. 분리된 참조로는 클릭/입력이 화면에
  // 반영되지 않으므로, 사용 직전에 항상 살아있는 요소로 갱신한다.
  // 편집 중인 카드는 하나뿐이라 화면에 보이는 질문 제목 입력란이 곧 현재 카드의 것이다.
  function refreshTitleEl(titleEl) {
    if (titleEl.isConnected) return titleEl;
    return getQuestionTitleFields()[0] || titleEl;
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
      titleEl = refreshTitleEl(titleEl);
      const addBtn = getAddOptionButton(titleEl);
      if (!addBtn) break;
      addBtn.click();
      await sleep(300);
      options = getOptionFieldsForCard(refreshTitleEl(titleEl));
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

  // 편집 중인 카드 하단 설정 줄의 "필수" 스위치를 켠다.
  // 접힌 카드에는 스위치가 렌더링되지 않으므로 현재 카드 것만 잡힌다.
  async function setRequired(titleEl) {
    const root = refreshTitleEl(titleEl).closest('[aria-label*="디자이너"]') || document;
    const sw = Array.from(root.querySelectorAll('[role="switch"]')).find((el) =>
      matchesAny(accessibleName(el), PATTERNS.required)
    );
    if (!sw) return false;
    if (sw.getAttribute("aria-checked") === "true") return true;
    sw.click();
    await sleep(200);
    return true;
  }

  async function insertChoiceQuestion(question, opts) {
    let titleEl = await addQuestionCard(PATTERNS.typeChoice, "선택 항목");
    await sleep(200);

    const titleOk = await fillField(titleEl, question.title);
    log(`  제목 ${titleOk ? "입력 완료" : "입력 실패"}: "${question.title}"`);
    await sleep(150);
    titleEl = refreshTitleEl(titleEl);

    const options = (question.options || []).slice(0, 4);
    const fields = await ensureOptionCount(titleEl, options.length);
    if (fields.length < options.length) {
      log(`  경고: 옵션 입력란을 ${options.length}개 중 ${fields.length}개만 찾았습니다.`);
    }

    const count = Math.min(fields.length, options.length);
    for (let i = 0; i < count; i++) {
      titleEl = refreshTitleEl(titleEl);
      const field = getOptionFieldsForCard(titleEl)[i];
      const ok = field ? await fillField(field, options[i]) : false;
      const correctMark = i === question.correctIndex ? " (정답)" : "";
      log(`  보기 ${i + 1}${correctMark} ${ok ? "입력 완료" : "입력 실패"}: "${options[i]}"`);
      await sleep(120);
    }

    if (opts.markCorrect && typeof question.correctIndex === "number") {
      await sleep(200);
      titleEl = refreshTitleEl(titleEl);
      const target = getOptionFieldsForCard(titleEl)[question.correctIndex];
      const ok = target ? markOptionCorrect(target) : false;
      log(ok
        ? `  정답 체크 완료: 보기 ${question.correctIndex + 1}`
        : `  정답 체크 실패: 정답 버튼을 찾지 못했습니다 (퀴즈 모드가 아닐 수 있음)`);
    }

    if (opts.markRequired) {
      const ok = await setRequired(titleEl);
      log(ok ? `  필수 설정 완료` : `  필수 설정 실패: 스위치를 찾지 못했습니다`);
    }
  }

  async function insertTextQuestion(question, opts) {
    let titleEl = await addQuestionCard(PATTERNS.typeText, "텍스트");
    await sleep(200);
    const titleOk = await fillField(titleEl, question.title);
    log(`  제목 ${titleOk ? "입력 완료" : "입력 실패"}: "${question.title}"`);
    if (opts.markRequired) {
      const ok = await setRequired(titleEl);
      log(ok ? `  필수 설정 완료` : `  필수 설정 실패: 스위치를 찾지 못했습니다`);
    }
    if (question.answer) {
      log(`  참고: 모범 답안("${question.answer}")은 자동으로 입력하지 않았습니다. 필요하면 수동으로 입력해주세요.`);
    }
  }

  // 폼 제목 설정: 제목 컨테이너를 클릭해 편집기를 열고 입력한다.
  // 편집 상태는 이후 다른 요소(질문 추가 버튼 등)를 클릭할 때 커밋된다.
  async function setFormTitle(title) {
    const container =
      findByAutomationId(AUTOMATION_IDS.formTitle) ||
      findClickable([/양식\s*제목/, /form\s*title/i], document.querySelector("main") || document);
    if (!container) return false;
    container.scrollIntoView({ block: "center" });
    container.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    container.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    container.click();
    const box = await waitFor(
      () => getAllTextboxes().find((el) => matchesAny(accessibleName(el), PATTERNS.formTitleBox)),
      { timeout: 3000 }
    );
    if (!box) return false;
    return fillField(box, title);
  }

  async function insertQuestions(questions, opts) {
    let inserted = 0;
    let failed = 0;
    for (const q of questions) {
      try {
        log(`문제 입력 중: "${q.title}"`);
        if (q.type === "text") {
          await insertTextQuestion(q, opts);
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

    // 카드가 접힌 뒤에도 내용이 남아있는지(내부 상태 반영 여부) 최종 확인.
    await sleep(600);
    const bodyText = normalizeText(document.body.textContent);
    for (const q of questions) {
      const snippet = normalizeText(q.title).slice(0, 25);
      if (!snippet) continue;
      log(bodyText.includes(snippet)
        ? `  저장 확인: "${snippet}..."`
        : `  저장 실패(내용이 사라짐): "${snippet}..."`);
    }

    return { inserted, failed };
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || !ev.data || ev.data.source !== "makeforms" || ev.data.type !== "INSERT") return;
    const { questions, options, formTitle, requestId } = ev.data;
    window.focus();
    (async () => {
      if (formTitle) {
        const ok = await setFormTitle(formTitle);
        log(ok ? `폼 제목 입력 완료: "${formTitle}"` : `폼 제목 입력 실패: "${formTitle}"`);
      }
      const result = await insertQuestions(questions, options || {});
      log(`완료: ${result.inserted}개 입력, ${result.failed}개 실패`);
      window.postMessage({ source: "makeforms", type: "RESULT", requestId, result }, "*");
    })();
  });
})();
