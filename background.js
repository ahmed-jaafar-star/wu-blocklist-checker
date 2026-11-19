chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "EXPORT_CSV") return false;

  (async () => {
    try {
      if (!Array.isArray(message.results)) {
        throw new Error("No result rows were supplied.");
      }

      const columns = [
        "Search MSISDN",
        "Date|Time",
        "User",
        "MSISDN",
        "Action"
      ];

      const escapeCSV = value =>
        '"' + String(value ?? "").replace(/"/g, '""') + '"';

      const csv = [
        columns.map(escapeCSV).join(","),
        ...message.results.map(row =>
          columns.map(column => escapeCSV(row[column])).join(",")
        )
      ].join("\r\n");

      const dataUrl = "data:text/csv;charset=utf-8," +
        encodeURIComponent("\uFEFF" + csv);

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

      await chrome.downloads.download({
        url: dataUrl,
        filename: `WuBlockList_${timestamp}.csv`,
        saveAs: true
      });

      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error?.message || String(error)
      });
    }
  })();

  return true;
});
