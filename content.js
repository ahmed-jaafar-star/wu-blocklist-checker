(() => {
  // Avoid registering duplicate listeners if injected more than once.
  if (window.__wuBlockListCheckerInstalled) return;
  window.__wuBlockListCheckerInstalled = true;

  let running = false;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function getSearchElements() {
    // Confirmed from the supplied page HTML:
    // <span id="msisdn"><input class="p-inputtext ... p-inputnumber-input">
    // <button aria-label="Search" ...>
    const input = document.querySelector('#msisdn input.p-inputnumber-input');
    const searchButton = document.querySelector('button[aria-label="Search"]');

    if (!input || !searchButton) {
      throw new Error(
        `Search controls not found (input=${!!input}, button=${!!searchButton}). ` +
        `Confirm the Wu BlockList page is open.`
      );
    }
    return { input, searchButton };
  }

  function setReactCompatibleValue(input, value) {
    // PrimeVue inputnumber wraps a normal input; use the native value setter.
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, "value"
    )?.set;

    if (!setter) throw new Error("Could not access the native input setter.");

    input.focus();
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function getResultTable() {
    const tables = [...document.querySelectorAll("table")];
    return tables.find(table => {
      const text = (table.querySelector("thead")?.innerText || table.innerText || "");
      return /MSISDN/i.test(text) && /Action/i.test(text);
    }) || null;
  }

  function getTableSnapshot() {
    const table = getResultTable();
    if (!table) return { tableFound: false, rows: [], text: "" };

    const rows = [...table.querySelectorAll("tbody tr")].map(tr =>
      [...tr.querySelectorAll("td")].map(td => td.innerText.trim())
    );

    return {
      tableFound: true,
      rows,
      text: table.innerText.trim()
    };
  }

  function normalizeDigits(value) {
    return String(value ?? "").replace(/\D/g, "");
  }

  function extractMatch(snapshot, searchedNumber) {
    const wanted = normalizeDigits(searchedNumber);

    for (const cells of snapshot.rows) {
      if (cells.length < 4) continue;
      if (normalizeDigits(cells[2]) === wanted) {
        return {
          "Search MSISDN": searchedNumber,
          "Date|Time": cells[0] || "",
          "User": cells[1] || "",
          "MSISDN": cells[2] || "",
          "Action": cells[3] || ""
        };
      }
    }
    return null;
  }

  function waitForResultChange(previousSnapshot, timeoutMs = 20000) {
    return new Promise(resolve => {
      let done = false;
      let quietTimer = null;
      let pollTimer = null;
      const started = Date.now();

      const table = getResultTable();
      const target = table || document.querySelector("#msisdn")?.parentElement?.parentElement || document.body;

      const finish = (timedOut = false) => {
        if (done) return;
        done = true;
        observer.disconnect();
        clearTimeout(quietTimer);
        clearInterval(pollTimer);
        resolve({ snapshot: getTableSnapshot(), timedOut });
      };

      const changed = () => {
        const now = getTableSnapshot();
        return now.text !== previousSnapshot.text ||
          JSON.stringify(now.rows) !== JSON.stringify(previousSnapshot.rows);
      };

      const observer = new MutationObserver(() => {
        if (changed()) {
          clearTimeout(quietTimer);
          quietTimer = setTimeout(() => finish(false), 700);
        }
      });

      observer.observe(target, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true
      });

      // Poll as a fallback in case updates are outside the observed table.
      pollTimer = setInterval(() => {
        if (changed()) {
          clearTimeout(quietTimer);
          quietTimer = setTimeout(() => finish(false), 700);
        } else if (Date.now() - started >= timeoutMs) {
          finish(true);
        }
      }, 250);

      // Always enforce timeout.
      setTimeout(() => finish(true), timeoutMs);
    });
  }

  async function searchOne(number) {
    const { input, searchButton } = getSearchElements();
    const previousSnapshot = getTableSnapshot();

    setReactCompatibleValue(input, number);

    // Let the component process input/change before clicking.
    await sleep(250);

    if (searchButton.disabled) {
      throw new Error("Search button is disabled.");
    }

    searchButton.click();

    const { snapshot, timedOut } = await waitForResultChange(previousSnapshot);

    const match = extractMatch(snapshot, number);
    if (match) return match;

    // Do not falsely label a timeout as "No Record".
    if (timedOut) {
      throw new Error("Timed out waiting for the result table to update.");
    }

    // A changed result table with no exact MSISDN match is treated as no record.
    return {
      "Search MSISDN": number,
      "Date|Time": "No Record",
      "User": "No Record",
      "MSISDN": "No Record",
      "Action": "No Record"
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "PING") {
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type !== "START_CHECK") return false;

    if (running) {
      sendResponse({ ok: false, error: "A batch is already running in this tab." });
      return false;
    }

    if (!Array.isArray(message.numbers) || !message.numbers.length) {
      sendResponse({ ok: false, error: "No numbers were provided." });
      return false;
    }

    running = true;
    sendResponse({ ok: true });

    runBatch(message.numbers)
      .catch(error => {
        chrome.runtime.sendMessage({
          type: "BATCH_FAILED",
          error: error?.message || String(error)
        }).catch(() => {});
      })
      .finally(() => { running = false; });

    return false;
  });

  async function runBatch(numbers) {
    const results = [];

    for (let i = 0; i < numbers.length; i++) {
      const number = numbers[i];

      try {
        results.push(await searchOne(number));
      } catch (error) {
        results.push({
          "Search MSISDN": number,
          "Date|Time": `ERROR: ${error.message || String(error)}`,
          "User": "",
          "MSISDN": "",
          "Action": ""
        });
      }

      chrome.runtime.sendMessage({
        type: "BATCH_PROGRESS",
        completed: i + 1,
        total: numbers.length,
        current: number
      }).catch(() => {});

      // Small gap to avoid overwhelming the system.
      await sleep(250);
    }

    const response = await chrome.runtime.sendMessage({
      type: "EXPORT_CSV",
      results
    });

    if (!response?.ok) {
      throw new Error(response?.error || "CSV export failed.");
    }

    chrome.runtime.sendMessage({
      type: "BATCH_FINISHED",
      total: numbers.length
    }).catch(() => {});
  }
})();
