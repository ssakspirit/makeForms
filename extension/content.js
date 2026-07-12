// 격리 월드 브리지: background <-> 페이지 월드(page.js) 사이에서 메시지를 중계한다.
// 실제 DOM 자동화는 page.js(MAIN world)에서 실행된다. 격리 월드에서 실행하면
// execCommand 기반 텍스트 입력이 Forms 내부 상태에 반영되지 않아
// 카드가 접힐 때 입력한 내용이 사라진다.

window.addEventListener("message", (ev) => {
  if (ev.source !== window || !ev.data || ev.data.source !== "makeforms") return;
  if (ev.data.type === "LOG") {
    chrome.runtime.sendMessage({ type: "MAKEFORMS_LOG", text: ev.data.text }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== "insertQuestions") return false;

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const onResult = (ev) => {
    if (ev.source !== window || !ev.data || ev.data.source !== "makeforms") return;
    if (ev.data.type !== "RESULT" || ev.data.requestId !== requestId) return;
    window.removeEventListener("message", onResult);
    sendResponse(ev.data.result);
  };
  window.addEventListener("message", onResult);

  window.postMessage(
    {
      source: "makeforms",
      type: "INSERT",
      requestId,
      questions: message.questions,
      options: message.options || {},
    },
    "*"
  );
  return true;
});
