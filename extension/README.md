# Spark Assistant for Chrome

A Chrome extension that connects Spark to your browser:

- **The assistant works with your real Chrome tabs.** Ask it to summarize or compare tabs, find
  something on a page, open pages, switch to a tab, group tabs by topic, or close tabs.
- **Side panel.** Click the Spark icon in the toolbar to open the assistant next to any page.
- **Any site can show inside Spark tabs.** Most sites refuse to be shown inside other sites. While
  a Spark tab is open, the extension removes that refusal for the pages framed inside that Spark tab
  only. Every other tab and site works exactly as before.

## Install

1. Download `spark-chrome-extension.zip` from your Spark site (the assistant links to it) and
   unzip it, or use this `extension/` folder from the repository.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the unzipped folder.
4. Optional: pin the Spark icon from the puzzle-piece menu.

Then open Spark. The assistant shows a **Spark tabs / Chrome tabs** switch, set to Chrome tabs.
Or click the toolbar icon to use the assistant in the side panel.

## Settings

Open the side panel and click the sliders icon:

- **Show any site inside Spark tabs**: on by default. Turn it off to let sites decide again.
- **Spark address**: the Spark site the extension works with. It starts as
  `https://chezburgar.github.io/Search-engine/`; change it if you run Spark elsewhere
  (for example `http://localhost:3000/`). Reload open Spark tabs afterwards.

## Permissions, and why

| Permission                      | Used for                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------- |
| Tabs, tab groups                | Listing, opening, switching, grouping and closing tabs when you ask.              |
| Scripting + access to all sites | Reading a tab's text and finding words on it, only when you ask the assistant to. |
| Declarative net request         | Removing "don't embed me" headers for pages framed inside Spark tabs only.        |
| Side panel, storage             | The side panel, and your two settings.                                            |

## Privacy and safety

- Only your Spark address can talk to the extension. The connection is a small script that runs on
  that site alone; no other website can use it.
- A tab's text is read only when the assistant needs it for your request. It's then sent to Spark's
  AI provider (Groq or xAI) to write the answer, like any other question you ask Spark.
- The assistant is told to treat page text as information, never as instructions. It closes or
  moves tabs only when you ask, and it can't close the tab it's running in.
- Removing embed protection is limited to frames inside Spark tabs. Those headers exist to stop
  other sites from tricking you into clicking things inside a framed page. Only use it on your own
  Spark site, and turn it off in the settings if you don't need it.

## Limits

- Chrome doesn't let extensions read or script `chrome://` pages, the Chrome Web Store, or other
  extensions' pages.
- Inside Spark tabs, sites may appear signed out (Chrome limits cookies in framed pages), and a few
  sites use scripts that still refuse to run in a frame.
- After updating the files, click the reload icon for the extension on `chrome://extensions`.
