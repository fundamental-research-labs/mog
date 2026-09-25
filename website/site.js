(function () {
  var button = document.getElementById("copy-prompt");
  var prompt = document.getElementById("agent-prompt");
  var status = document.getElementById("copy-status");

  function textOf(node) {
    return node.textContent.replace(/^\n/, "").replace(/\n$/, "");
  }

  function markCopied() {
    if (!status) return;
    status.textContent = "Copied";
  }

  function selectPrompt() {
    var details = prompt.closest("details");
    if (details) details.open = true;
    var range = document.createRange();
    range.selectNodeContents(prompt);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    if (status) status.textContent = "Select the prompt and copy it";
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
