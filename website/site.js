(function () {
  var button = document.getElementById("copy-prompt");
  var prompt = document.getElementById("agent-prompt");
  var toggle = document.getElementById("toggle-prompt");
  var label = "Copy prompt";
  var timer;

  function textOf(node) {
    return node.textContent.replace(/^\n/, "").replace(/\n$/, "");
  }

  function setPrompt(open) {
    prompt.hidden = !open;
    toggle.textContent = open ? "hide" : "show";
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function markCopied() {
    button.textContent = "copied!";
    clearTimeout(timer);
    timer = setTimeout(function () { button.textContent = label; }, 2000);
  }

  function selectPrompt() {
    setPrompt(true);
    var range = document.createRange();
    range.selectNodeContents(prompt);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  if (toggle && prompt) {
    toggle.addEventListener("click", function () {
      setPrompt(prompt.hidden);
    });
  }

  if (button && prompt) {
    button.addEventListener("click", function () {
      var text = textOf(prompt);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(markCopied, selectPrompt);
      } else {
        selectPrompt();
      }
    });
  }

  var stars = document.getElementById("github-stars");
  var link = document.getElementById("github-link");
  if (!stars) return;
  fetch("https://api.github.com/repos/fundamental-research-labs/mog")
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (data) {
      if (!data || typeof data.stargazers_count !== "number") return;
      var count = data.stargazers_count;
      stars.textContent = count >= 1000
        ? new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(count)
        : String(count);
      if (link) link.setAttribute("aria-label", count + " GitHub stars");
    })
    .catch(function () {});
})();
