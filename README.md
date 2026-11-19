# Wu BlockList Checker

A Chrome extension that checks a whole list of MSISDNs against the Wu BlockList page in one run. Paste the numbers, press start, and get one CSV with the result for each number, instead of searching them one by one.

## How it works

1. The popup takes one number per line and removes duplicates.
2. It finds the open, signed-in BlockList tab and injects `content.js` if it isn't loaded yet.
3. For each number, `content.js` sets the search box through the native input setter, fires `input` and `change` so the PrimeVue field picks it up, then clicks *Search*.
4. It waits for the result table to change (a MutationObserver plus polling, with a 20-second timeout) and takes the row whose MSISDN matches exactly.
5. No match is written as `No Record`. A timeout is written as an error, never as `No Record`, so a slow page can't hide a blocked number.
6. When the batch ends, `background.js` builds the CSV (UTF-8 with BOM, so Excel reads it correctly) and asks where to save it.

CSV columns: `Search MSISDN`, `Date|Time`, `User`, `MSISDN`, `Action`.

## Setup

1. Download this repo (**Code** → **Download ZIP**) and unzip it.
2. Replace `cms.example.com` with your system's address in `manifest.json` and `popup.js`.
3. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the folder.

## Notes

- Keep the BlockList tab open while the batch runs. The popup can be closed.
- There's a 250 ms pause between searches so the system isn't flooded.
