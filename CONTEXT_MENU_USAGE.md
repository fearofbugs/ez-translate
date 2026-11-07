# Context Menu Translation Feature Guide

## Overview

The EZ Translate extension now supports context menu translation, letting you select text on any webpage and translate it quickly via the right-click menu.

## How to Use

### 1. Select text
Select the text you want to translate on any webpage.

### 2. Right-click menu
Right-click the selected text and you'll see the "LLM Translate" menu item.

### 3. Choose a translation option
- **Translate to [Primary Target Language]**: Translates the text into your primary target language
- **Translate to [Secondary Target Language]**: Translates the text into your secondary target language
- **Open Settings**: Quickly opens the extension settings page

### 4. View the translation result
After choosing a translation option, a result window pops up in the center of the page showing:
- The original text
- The translation
- A close button

## Menu Structure

```
LLM Translate
├── Translate to [Primary Target Language]
├── Translate to [Secondary Target Language]
├── ──────────────── (separator)
└── Open Settings
```

## Language Settings

The language names shown in the context menu update automatically based on the target languages you configure on the settings page:

1. Open the extension settings page
2. In the "Target Language Settings" section, configure:
   - **Default Target Language**: the primary translation target
   - **Second Target Language**: the secondary translation target
3. After saving, the context menu updates automatically to show the new language names

## Supported Languages

The extension supports context menu UIs in 12 languages:
- 🇺🇸 English
- 🇨🇳 简体中文 (Simplified Chinese)
- 🇹🇼 繁體中文 (Traditional Chinese)
- 🇸🇦 العربية (Arabic)
- 🇧🇩 বাংলা (Bengali)
- 🇩🇪 Deutsch (German)
- 🇪🇸 Español (Spanish)
- 🇫🇷 Français (French)
- 🇮🇳 हिन्दी (Hindi)
- 🇯🇵 日本語 (Japanese)
- 🇰🇷 한국어 (Korean)
- 🇵🇹 Português (Portuguese)
- 🇷🇺 Русский (Russian)

## Technical Highlights

- **Smart language detection**: Automatically detects the source language; if it matches the target language, the second target language is used
- **Dynamic menu updates**: The context menu updates automatically whenever language settings change
- **Multilingual support**: The context menu UI supports 12 languages
- **Consistent experience**: Uses the same translation engine and settings as the existing text-selection translation feature

## Notes

1. The context menu feature requires the `contextMenus` permission, which is already configured in manifest.json
2. Translation results appear in a popup; the original text is never replaced
3. If translation fails, an error message is displayed
4. You can close the result by clicking the popup's close button or clicking elsewhere on the page

## Troubleshooting

If the context menu doesn't appear:
1. Make sure text is selected
2. Check that the extension is enabled
3. Try refreshing the page and retrying
4. Check the browser console for error messages

If translation fails:
1. Check that the API key is configured correctly
2. Check your network connection
3. Look at the error message in the translation result popup
4. Try reconfiguring the API key on the settings page
