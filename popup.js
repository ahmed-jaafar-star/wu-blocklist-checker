const startButton = document.getElementById("start");
const numbersInput = document.getElementById("numbers");
const statusBox = document.getElementById("status");

function showStatus(message) {
  statusBox.textContent = message;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "BATCH_PROGRESS") {
    showStatus(`Progress: ${message.completed}/${message.total} — ${message.current}`);
  } else if (message.type === "BATCH_FINISHED") {
    showStatus(`Finished: ${message.total} numbers. CSV download requested.`);
    startButton.disabled = false;
  } else if (message.type === "BATCH_FAILED") {
    showStatus(`Stopped: ${message.error}`);
    startButton.disabled = false;
  }
});

startButton.addEventListener("click", async () => {
  const numbers = [...new Set(
    numbersInput.value.split(/\r?\n/).map(n => n.trim()).filter(Boolean)
  )];

  if (!numbers.length) {
    showStatus("Enter at least one MSISDN.");
    return;
  }

  startButton.disabled = true;
  showStatus("Connecting to the Wu BlockList tab…");

  try {
    const tabs = await chrome.tabs.query({
      url: "https://cms.example.com/app/mobile-menus*"
    });

    const tab = tabs.find(t => t.id != null);

    if (!tab) {
      throw new Error("Open the signed-in Wu BlockList page first.");
    }

    try {
      await chrome.tabs.sendMessage(tab.id, { type: "PING" });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
      await chrome.tabs.sendMessage(tab.id, { type: "PING" });
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "START_CHECK",
      numbers
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not start the batch.");
    }

    showStatus(`Started ${numbers.length} numbers. You can close this popup, but keep the system tab open.`);
  } catch (error) {
    showStatus(error.message || String(error));
    startButton.disabled = false;
  }
});
