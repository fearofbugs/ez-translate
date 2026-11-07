importScripts('../shared/prompts.js', 'learning.js', '../shared/model-catalog.js', 'model-queue.js');
// background.js - Multi-provider background service worker

// --- Initialization & installation ---
chrome.runtime.onInstalled.addListener(() => {
    console.log("LLM-Translate extension installed or updated.");
    
    // Create the context menu
    createContextMenus();
    
    // Set initial default values only when they don't exist
    chrome.storage.local.get(null, (items) => {
        const defaults = {
            activeProvider: 'gemini',
            geminiApiKey: '',
            geminiSelectedModel: '',
            siliconflowApiKey: '',
            siliconflowSelectedModel: '',
            ollamaUrl: 'http://localhost:11434',
            ollamaSelectedModel: '',
            // Use language keys instead of localized names to stay consistent with settings/popup
            targetLanguage: 'langSimplifiedChinese',
            secondTargetLanguage: 'langEnglish'
        };
        let itemsToSet = {};
        for (const key in defaults) {
            if (items[key] === undefined) {
                itemsToSet[key] = defaults[key];
            }
        }
        if (Object.keys(itemsToSet).length > 0) {
            chrome.storage.local.set(itemsToSet);
            console.log("Set initial default values:", itemsToSet);
        }
    });
});

// --- Context menu creation ---
function createContextMenus() {
    // Remove existing menu items
    chrome.contextMenus.removeAll(() => {
        // Get the current language settings
        chrome.storage.local.get(['targetLanguage', 'secondTargetLanguage'], (result) => {
            const primaryLang = result.targetLanguage || 'langSimplifiedChinese';
            const secondaryLang = result.secondTargetLanguage || 'langEnglish';
            
            // Get the language names
            const primaryLangName = normalizeLanguageToEnglishName(primaryLang);
            const secondaryLangName = normalizeLanguageToEnglishName(secondaryLang);
            
            // Create the parent menu item
            chrome.contextMenus.create({
                id: 'translate-selection',
                title: chrome.i18n.getMessage('contextMenuTranslate'),
                contexts: ['selection']
            });
            
            // Create the submenu item - translate to primary target language
            chrome.contextMenus.create({
                id: 'translate-to-primary',
                parentId: 'translate-selection',
                title: chrome.i18n.getMessage('contextMenuTranslateToPrimary', [primaryLangName]),
                contexts: ['selection']
            });
            
            // Create the submenu item - translate to secondary target language
            chrome.contextMenus.create({
                id: 'translate-to-secondary',
                parentId: 'translate-selection',
                title: chrome.i18n.getMessage('contextMenuTranslateToSecondary', [secondaryLangName]),
                contexts: ['selection']
            });
            
            // Create a separator
            chrome.contextMenus.create({
                id: 'separator1',
                parentId: 'translate-selection',
                type: 'separator',
                contexts: ['selection']
            });
            
            // Create the settings menu item
            chrome.contextMenus.create({
                id: 'open-settings',
                parentId: 'translate-selection',
                title: chrome.i18n.getMessage('contextMenuOpenSettings'),
                contexts: ['selection']
            });
        });
    });
}

// --- Keyboard shortcut listener ---
chrome.commands.onCommand.addListener((command) => {
    console.log('[LLM-Translate] Command received:', command);
    
    if (command === 'capture-selected-area') {
        // Get the current active tab
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) {
                console.log('[LLM-Translate] Sending startScreenshotSelection to tab:', tabs[0].id);
                // Send a start-screenshot-selection message to the active tab
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'startScreenshotSelection'
                }).catch((error) => {
                    console.error('[LLM-Translate] Error sending startScreenshotSelection:', error);
                });
            }
        });
    } else if (command === 'toggle-floating-panel') {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'toggleFloatingPanel'
                }).catch((error) => {
                    console.error('[LLM-Translate] Error sending toggleFloatingPanel:', error);
                });
            }
        });
    }
});

// --- Message listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'translate') {
        handleTranslation(request.text, request.targetLanguage, request.secondTargetLanguage, sendResponse);
        return true; // Respond asynchronously
    } else if (request.type === 'captureAndTranslateImage') {
        console.log('[LLM-Translate] captureAndTranslateImage received', request.rect);
        handleCaptureAndTranslateImage(request.rect, sender, sendResponse);
        return true;
    }
});

// --- Listen for setting changes and update the context menu ---
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && 
        (changes.targetLanguage || changes.secondTargetLanguage)) {
        // Recreate the context menu when target language settings change
        createContextMenus();
    }
});

// --- Context menu click handler ---
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'translate-to-primary' || info.menuItemId === 'translate-to-secondary') {
        handleContextMenuTranslation(info, tab);
    } else if (info.menuItemId === 'open-settings') {
        chrome.runtime.openOptionsPage();
    }
});

// --- Handle context-menu translation ---
async function handleContextMenuTranslation(info, tab) {
    const selectedText = info.selectionText;
    if (!selectedText || selectedText.trim().length === 0) {
        return;
    }
    
    try {
        // Get the current language settings
        const { targetLanguage, secondTargetLanguage } = await chrome.storage.local.get(['targetLanguage', 'secondTargetLanguage']);
        const primaryTargetLanguageKey = targetLanguage || 'langSimplifiedChinese';
        const secondaryTargetLanguageKey = secondTargetLanguage || 'langEnglish';
        
        // Determine which target language to use
        let actualTargetLanguage, actualSecondTargetLanguage;
        if (info.menuItemId === 'translate-to-primary') {
            actualTargetLanguage = primaryTargetLanguageKey;
            actualSecondTargetLanguage = secondaryTargetLanguageKey;
        } else {
            actualTargetLanguage = secondaryTargetLanguageKey;
            actualSecondTargetLanguage = primaryTargetLanguageKey;
        }
        
        // Normalize the language names
        const primaryTargetLanguageName = normalizeLanguageToEnglishName(actualTargetLanguage);
        const secondaryTargetLanguageName = normalizeLanguageToEnglishName(actualSecondTargetLanguage);
        
        // Send the translation request to the content script
        await chrome.tabs.sendMessage(tab.id, {
            type: 'contextMenuTranslate',
            text: selectedText,
            targetLanguage: primaryTargetLanguageName,
            secondTargetLanguage: secondaryTargetLanguageName
        });
        
    } catch (error) {
        console.error('Context-menu translation failed:', error);
    }
}

// --- Language name normalization function ---
function normalizeLanguageToEnglishName(langValue) {
    // Map of language keys to English names
    const langKeyToEnName = {
        'langEnglish': 'English',
        'langSimplifiedChinese': 'Simplified Chinese',
        'langTraditionalChinese': 'Traditional Chinese',
        'langFrench': 'French',
        'langSpanish': 'Spanish',
        'langArabic': 'Arabic',
        'langRussian': 'Russian',
        'langPortuguese': 'Portuguese',
        'langGerman': 'German',
        'langItalian': 'Italian',
        'langDutch': 'Dutch',
        'langDanish': 'Danish',
        'langIrish': 'Irish',
        'langWelsh': 'Welsh',
        'langFinnish': 'Finnish',
        'langIcelandic': 'Icelandic',
        'langSwedish': 'Swedish',
        'langNorwegianNynorsk': 'Norwegian Nynorsk',
        'langNorwegianBokmal': 'Norwegian Bokmål',
        'langJapanese': 'Japanese',
        'langKorean': 'Korean',
        'langVietnamese': 'Vietnamese',
        'langThai': 'Thai',
        'langIndonesian': 'Indonesian',
        'langMalay': 'Malay',
        'langBurmese': 'Burmese',
        'langTagalog': 'Tagalog',
        'langKhmer': 'Khmer',
        'langLao': 'Lao',
        'langHindi': 'Hindi',
        'langBengali': 'Bengali',
        'langUrdu': 'Urdu',
        'langNepali': 'Nepali',
        'langHebrew': 'Hebrew',
        'langTurkish': 'Turkish',
        'langPersian': 'Persian',
        'langPolish': 'Polish',
        'langUkrainian': 'Ukrainian',
        'langCzech': 'Czech',
        'langRomanian': 'Romanian',
        'langBulgarian': 'Bulgarian',
        'langSlovak': 'Slovak',
        'langHungarian': 'Hungarian',
        'langSlovenian': 'Slovenian',
        'langLatvian': 'Latvian',
        'langEstonian': 'Estonian',
        'langLithuanian': 'Lithuanian',
        'langBelarusian': 'Belarusian',
        'langGreek': 'Greek',
        'langCroatian': 'Croatian',
        'langMacedonian': 'Macedonian',
        'langMaltese': 'Maltese',
        'langSerbian': 'Serbian',
        'langBosnian': 'Bosnian',
        'langGeorgian': 'Georgian',
        'langArmenian': 'Armenian',
        'langNorthAzerbaijani': 'North Azerbaijani',
        'langKazakh': 'Kazakh',
        'langNorthernUzbek': 'Northern Uzbek',
        'langTajik': 'Tajik',
        'langSwahili': 'Swahili',
        'langAfrikaans': 'Afrikaans',
        'langCantonese': 'Cantonese',
        'langLuxembourgish': 'Luxembourgish',
        'langLimburgish': 'Limburgish',
        'langCatalan': 'Catalan',
        'langGalician': 'Galician',
        'langAsturian': 'Asturian',
        'langBasque': 'Basque',
        'langOccitan': 'Occitan',
        'langVenetian': 'Venetian',
        'langSardinian': 'Sardinian',
        'langSicilian': 'Sicilian',
        'langFriulian': 'Friulian',
        'langLombard': 'Lombard',
        'langLigurian': 'Ligurian',
        'langFaroese': 'Faroese',
        'langToskAlbanian': 'Tosk Albanian',
        'langSilesian': 'Silesian',
        'langBashkir': 'Bashkir',
        'langTatar': 'Tatar',
        'langMesopotamianArabic': 'Mesopotamian Arabic',
        'langNajdiArabic': 'Najdi Arabic',
        'langEgyptianArabic': 'Egyptian Arabic',
        'langLevantineArabic': 'Levantine Arabic',
        'langTaizziAdeniArabic': 'Taizzi-Adeni Arabic',
        'langDari': 'Dari',
        'langTunisianArabic': 'Tunisian Arabic',
        'langMoroccanArabic': 'Moroccan Arabic',
        'langKabuverdianu': 'Kabuverdianu',
        'langTokPisin': 'Tok Pisin',
        'langEasternYiddish': 'Eastern Yiddish',
        'langSindhi': 'Sindhi',
        'langSinhala': 'Sinhala',
        'langTelugu': 'Telugu',
        'langPunjabi': 'Punjabi',
        'langTamil': 'Tamil',
        'langGujarati': 'Gujarati',
        'langMalayalam': 'Malayalam',
        'langMarathi': 'Marathi',
        'langKannada': 'Kannada',
        'langMagahi': 'Magahi',
        'langOriya': 'Oriya',
        'langAwadhi': 'Awadhi',
        'langMaithili': 'Maithili',
        'langAssamese': 'Assamese',
        'langChhattisgarhi': 'Chhattisgarhi',
        'langBhojpuri': 'Bhojpuri',
        'langMinangkabau': 'Minangkabau',
        'langBalinese': 'Balinese',
        'langJavanese': 'Javanese',
        'langBanjar': 'Banjar',
        'langSundanese': 'Sundanese',
        'langCebuano': 'Cebuano',
        'langPangasinan': 'Pangasinan',
        'langIloko': 'Iloko',
        'langWarayPhilippines': 'Waray (Philippines)',
        'langHaitian': 'Haitian',
        'langPapiamento': 'Papiamento'
    };
    
    // Map of common localized names to English names
    const localizedToEnNameMap = {
        '中文': 'Simplified Chinese',
        '简体中文': 'Simplified Chinese',
        '繁體中文': 'Traditional Chinese',
        'English': 'English',
        '英文': 'English',
        'Français': 'French',
        '法文': 'French',
        'Español': 'Spanish',
        '西班牙文': 'Spanish',
        'العربية': 'Arabic',
        '阿拉伯文': 'Arabic',
        'Русский': 'Russian',
        '俄文': 'Russian',
        'Português': 'Portuguese',
        '葡萄牙文': 'Portuguese',
        'Deutsch': 'German',
        '德文': 'German',
        'Italiano': 'Italian',
        '意大利文': 'Italian',
        'Nederlands': 'Dutch',
        '荷兰文': 'Dutch',
        'Dansk': 'Danish',
        '丹麦文': 'Danish',
        'Gaeilge': 'Irish',
        '爱尔兰文': 'Irish',
        'Cymraeg': 'Welsh',
        '威尔士文': 'Welsh',
        'Suomi': 'Finnish',
        '芬兰文': 'Finnish',
        'Íslenska': 'Icelandic',
        '冰岛文': 'Icelandic',
        'Svenska': 'Swedish',
        '瑞典文': 'Swedish',
        'Norsk Nynorsk': 'Norwegian Nynorsk',
        '新挪威文': 'Norwegian Nynorsk',
        'Norsk Bokmål': 'Norwegian Bokmål',
        '书面挪威文': 'Norwegian Bokmål',
        '日本語': 'Japanese',
        '日文': 'Japanese',
        '한국어': 'Korean',
        '韩文': 'Korean',
        'Tiếng Việt': 'Vietnamese',
        '越南文': 'Vietnamese',
        'ไทย': 'Thai',
        '泰文': 'Thai',
        'Bahasa Indonesia': 'Indonesian',
        '印尼文': 'Indonesian',
        'Bahasa Melayu': 'Malay',
        '马来文': 'Malay',
        'မြန်မာဘာသာ': 'Burmese',
        '缅甸文': 'Burmese',
        'Tagalog': 'Tagalog',
        '他加禄文': 'Tagalog',
        'ភាសាខ្មែរ': 'Khmer',
        '高棉文': 'Khmer',
        'ພາສາລາວ': 'Lao',
        '老挝文': 'Lao',
        'हिन्दी': 'Hindi',
        '印地文': 'Hindi',
        'বাংলা': 'Bengali',
        '孟加拉文': 'Bengali',
        'اردو': 'Urdu',
        '乌尔都文': 'Urdu',
        'नेपाली': 'Nepali',
        '尼泊尔文': 'Nepali',
        'עברית': 'Hebrew',
        '希伯来文': 'Hebrew',
        'Türkçe': 'Turkish',
        '土耳其文': 'Turkish',
        'فارسی': 'Persian',
        '波斯文': 'Persian',
        'Polski': 'Polish',
        '波兰文': 'Polish',
        'Українська': 'Ukrainian',
        '乌克兰文': 'Ukrainian',
        'Čeština': 'Czech',
        '捷克文': 'Czech',
        'Română': 'Romanian',
        '罗马尼亚文': 'Romanian',
        'Български': 'Bulgarian',
        '保加利亚文': 'Bulgarian',
        'Slovenčina': 'Slovak',
        '斯洛伐克文': 'Slovak',
        'Magyar': 'Hungarian',
        '匈牙利文': 'Hungarian',
        'Slovenščina': 'Slovenian',
        '斯洛文尼亚文': 'Slovenian',
        'Latviešu': 'Latvian',
        '拉脱维亚文': 'Latvian',
        'Eesti': 'Estonian',
        '爱沙尼亚文': 'Estonian',
        'Lietuvių': 'Lithuanian',
        '立陶宛文': 'Lithuanian',
        'Беларуская': 'Belarusian',
        '白俄罗斯文': 'Belarusian',
        'Ελληνικά': 'Greek',
        '希腊文': 'Greek',
        'Hrvatski': 'Croatian',
        '克罗地亚文': 'Croatian',
        'Македонски': 'Macedonian',
        '马其顿文': 'Macedonian',
        'Malti': 'Maltese',
        '马耳他文': 'Maltese',
        'Српски': 'Serbian',
        '塞尔维亚文': 'Serbian',
        'Bosanski': 'Bosnian',
        '波斯尼亚文': 'Bosnian',
        'ქართული': 'Georgian',
        '格鲁吉亚文': 'Georgian',
        'Հայերեն': 'Armenian',
        '亚美尼亚文': 'Armenian',
        'Azərbaycan': 'North Azerbaijani',
        '阿塞拜疆文': 'North Azerbaijani',
        'Қазақ': 'Kazakh',
        '哈萨克文': 'Kazakh',
        'O\'zbek': 'Northern Uzbek',
        '乌兹别克文': 'Northern Uzbek',
        'Тоҷикӣ': 'Tajik',
        '塔吉克文': 'Tajik',
        'Kiswahili': 'Swahili',
        '斯瓦希里文': 'Swahili',
        'Afrikaans': 'Afrikaans',
        '南非荷兰文': 'Afrikaans',
        '粵語': 'Cantonese',
        '粤语': 'Cantonese',
        'Lëtzebuergesch': 'Luxembourgish',
        '卢森堡文': 'Luxembourgish',
        'Limburgs': 'Limburgish',
        '林堡文': 'Limburgish',
        'Català': 'Catalan',
        '加泰罗尼亚文': 'Catalan',
        'Galego': 'Galician',
        '加利西亚文': 'Galician',
        'Asturianu': 'Asturian',
        '阿斯图里亚斯文': 'Asturian',
        'Euskara': 'Basque',
        '巴斯克文': 'Basque',
        'Occitan': 'Occitan',
        '奥克文': 'Occitan',
        'Vèneto': 'Venetian',
        '威尼斯文': 'Venetian',
        'Sardu': 'Sardinian',
        '撒丁文': 'Sardinian',
        'Sicilianu': 'Sicilian',
        '西西里文': 'Sicilian',
        'Furlan': 'Friulian',
        '弗留利文': 'Friulian',
        'Lombard': 'Lombard',
        '伦巴第文': 'Lombard',
        'Ligure': 'Ligurian',
        '利古里亚文': 'Ligurian',
        'Føroyskt': 'Faroese',
        '法罗文': 'Faroese',
        'Shqip': 'Tosk Albanian',
        '阿尔巴尼亚文': 'Tosk Albanian',
        'Ślōnski': 'Silesian',
        '西里西亚文': 'Silesian',
        'Башҡорт': 'Bashkir',
        '巴什基尔文': 'Bashkir',
        'Татар': 'Tatar',
        '鞑靼文': 'Tatar',
        'اللهجة العراقية': 'Mesopotamian Arabic',
        '伊拉克阿拉伯文': 'Mesopotamian Arabic',
        'اللهجة النجدية': 'Najdi Arabic',
        '内志阿拉伯文': 'Najdi Arabic',
        'اللهجة المصرية': 'Egyptian Arabic',
        '埃及阿拉伯文': 'Egyptian Arabic',
        'اللهجة الشامية': 'Levantine Arabic',
        '黎凡特阿拉伯文': 'Levantine Arabic',
        'اللهجة التهامية': 'Taizzi-Adeni Arabic',
        '塔伊兹-亚丁阿拉伯文': 'Taizzi-Adeni Arabic',
        'دری': 'Dari',
        '达里文': 'Dari',
        'اللهجة التونسية': 'Tunisian Arabic',
        '突尼斯阿拉伯文': 'Tunisian Arabic',
        'اللهجة المغربية': 'Moroccan Arabic',
        '摩洛哥阿拉伯文': 'Moroccan Arabic',
        'Kabuverdianu': 'Kabuverdianu',
        '卡布佛得角文': 'Kabuverdianu',
        'Tok Pisin': 'Tok Pisin',
        '托克皮辛文': 'Tok Pisin',
        'יידיש': 'Eastern Yiddish',
        '意第绪文': 'Eastern Yiddish',
        'سنڌي': 'Sindhi',
        '信德文': 'Sindhi',
        'සිංහල': 'Sinhala',
        '僧伽罗文': 'Sinhala',
        'తెలుగు': 'Telugu',
        '泰卢固文': 'Telugu',
        'ਪੰਜਾਬੀ': 'Punjabi',
        '旁遮普文': 'Punjabi',
        'தமிழ்': 'Tamil',
        '泰米尔文': 'Tamil',
        'ગુજરાતી': 'Gujarati',
        '古吉拉特文': 'Gujarati',
        'മലയാളം': 'Malayalam',
        '马拉雅拉姆文': 'Malayalam',
        'मराठी': 'Marathi',
        '马拉地文': 'Marathi',
        'ಕನ್ನಡ': 'Kannada',
        '卡纳达文': 'Kannada',
        'मगही': 'Magahi',
        '摩揭陀文': 'Magahi',
        'ଓଡ଼ିଆ': 'Oriya',
        '奥里亚文': 'Oriya',
        'अवधी': 'Awadhi',
        '阿瓦德语': 'Awadhi',
        'मैथिली': 'Maithili',
        '迈蒂利文': 'Maithili',
        'অসমীয়া': 'Assamese',
        '阿萨姆文': 'Assamese',
        'छत्तीसगढ़ी': 'Chhattisgarhi',
        '恰蒂斯加尔文': 'Chhattisgarhi',
        'भोजपुरी': 'Bhojpuri',
        '博杰普尔文': 'Bhojpuri',
        'Baso Minangkabau': 'Minangkabau',
        '米南加保文': 'Minangkabau',
        'Basa Bali': 'Balinese',
        '巴厘文': 'Balinese',
        'Basa Jawa': 'Javanese',
        '爪哇文': 'Javanese',
        'Bahasa Banjar': 'Banjar',
        '班贾尔文': 'Banjar',
        'Basa Sunda': 'Sundanese',
        '巽他文': 'Sundanese',
        'Binisaya': 'Cebuano',
        '宿务文': 'Cebuano',
        'Salitan Pangasinan': 'Pangasinan',
        '邦阿西楠文': 'Pangasinan',
        'Pagsasao nga Ilokano': 'Iloko',
        '伊洛卡诺文': 'Iloko',
        'Winaray': 'Waray (Philippines)',
        '瓦赖文': 'Waray (Philippines)',
        'Kreyòl Ayisyen': 'Haitian',
        '海地克里奥尔文': 'Haitian',
        'Papiamento': 'Papiamento',
        '帕皮阿门托文': 'Papiamento'
    };
    
    if (langKeyToEnName[langValue]) {
        return langKeyToEnName[langValue];
    } else if (localizedToEnNameMap[langValue]) {
        return localizedToEnNameMap[langValue];
    } else {
        // If none match, return the original value (it may already be an English name)
        return langValue;
    }
}

// --- Core translation handling ---
async function handleTranslation(text, targetLanguage, secondTargetLanguage, sendResponse) {
    try {
        const settings = await chrome.storage.local.get(null);
        sendResponse(await translateWithQueue(settings, text, null, { targetLanguage, secondTargetLanguage }));
    } catch (error) {
        sendResponse({ error: `Translation failed: ${error.message}`, timing: error.timing });
    }
}

// --- Language detection & target language determination ---
async function determineTargetLanguage(text, targetLanguage, secondTargetLanguage) {
    return new Promise((resolve) => {
        chrome.i18n.detectLanguage(text, (result) => {
            if (result && result.languages && result.languages.length > 0) {
                const detectedLanguage = result.languages[0].language;
                const confidence = result.languages[0].percentage;
                
                // Map detected language to target language format
                const detectedLangName = mapLanguageCodeToName(detectedLanguage);
                
                // If detected language matches target language, use second target language
                if (detectedLangName === targetLanguage && confidence > 50) {
                    console.log(`Source language (${detectedLangName}) matches target language (${targetLanguage}), using second target language (${secondTargetLanguage})`);
                    resolve(secondTargetLanguage);
                } else {
                    console.log(`Using primary target language: ${targetLanguage}`);
                    resolve(targetLanguage);
                }
            } else {
                // If language detection fails, use primary target language
                console.log(`Language detection failed, using primary target language: ${targetLanguage}`);
                resolve(targetLanguage);
            }
        });
    });
}

function mapLanguageCodeToName(languageCode) {
    const languageMap = {
        'en': 'English',
        'zh': 'Simplified Chinese',
        'zh-CN': 'Simplified Chinese',
        'zh-TW': 'Traditional Chinese',
        'fr': 'French',
        'es': 'Spanish',
        'ar': 'Arabic',
        'ru': 'Russian',
        'pt': 'Portuguese',
        'de': 'German',
        'it': 'Italian',
        'nl': 'Dutch',
        'da': 'Danish',
        'ja': 'Japanese',
        'ko': 'Korean',
        'sv': 'Swedish',
        'no': 'Norwegian Bokmål',
        'pl': 'Polish',
        'tr': 'Turkish',
        'fi': 'Finnish',
        'hu': 'Hungarian',
        'cs': 'Czech',
        'el': 'Greek',
        'hi': 'Hindi',
        'id': 'Indonesian',
        'th': 'Thai',
        'vi': 'Vietnamese',
        'ro': 'Romanian',
        'sk': 'Slovak'
    };
    
    return languageMap[languageCode] || 'English';
}

// --- Screenshot & translate text in images ---
async function handleCaptureAndTranslateImage(rect, sender, sendResponse) {
    try {
        // Capture visible tab
        const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
        console.log('[LLM-Translate] captureVisibleTab success');
        // Crop to rect using OffscreenCanvas
        const croppedDataUrl = await cropImageDataUrl(dataUrl, rect);
        console.log('[LLM-Translate] cropImageDataUrl success');

        const settings = await chrome.storage.local.get(null);
        const result = await translateWithQueue(settings, 'Read the text in this image.', croppedDataUrl);
        if (sender?.tab?.id) await chrome.tabs.sendMessage(sender.tab.id, { type: 'showImageTranslationResult', ...result });
        sendResponse(result);
    } catch (e) {
        console.error('[LLM-Translate] handleCaptureAndTranslateImage failed:', e);
        sendResponse({ error: e.message, timing: e.timing });
    }
}

async function cropImageDataUrl(dataUrl, rect) {
    // Use createImageBitmap in service worker
    const resp = await fetch(dataUrl);
    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob);
    const dpr = rect.devicePixelRatio || 1;
    const sx = Math.max(0, Math.round(rect.x * dpr));
    const sy = Math.max(0, Math.round(rect.y * dpr));
    const sw = Math.min(bitmap.width - sx, Math.round(rect.width * dpr));
    const sh = Math.min(bitmap.height - sy, Math.round(rect.height * dpr));
    const canvas = new OffscreenCanvas(sw, sh);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    const outBlob = await canvas.convertToBlob({ type: 'image/png' });
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(outBlob);
    });
}

async function visionTranslateGemini(imageDataUrl) {
    const { geminiApiKey, geminiSelectedModel, targetLanguage, secondTargetLanguage } = await chrome.storage.local.get(['geminiApiKey', 'geminiSelectedModel', 'targetLanguage', 'secondTargetLanguage']);
    const apiKey = geminiApiKey; const modelName = geminiSelectedModel;
    if (!apiKey || !modelName) throw new Error('Gemini API or model is not configured');
    const prompt = 'Read the text in the attached image.';

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const parts = [{ text: prompt }, { inline_data: { mime_type: 'image/png', data: imageDataUrl.split(',')[1] } }];
    const resp = await learningFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts }] }) });
    if (!resp.ok) throw new Error('Gemini Vision request failed');
    const data = await resp.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

async function visionTranslateOpenAICompatible(imageDataUrl) {
    const { siliconflowApiKey, siliconflowSelectedModel, targetLanguage, secondTargetLanguage } = await chrome.storage.local.get(['siliconflowApiKey', 'siliconflowSelectedModel', 'targetLanguage', 'secondTargetLanguage']);
    const apiKey = siliconflowApiKey; const modelName = siliconflowSelectedModel;
    if (!apiKey || !modelName) throw new Error('SiliconFlow API or model is not configured');
    const userPrompt = 'Read the text in the attached image.';

    const url = 'https://api.siliconflow.cn/v1/chat/completions';
    const messages = [
        { role: 'user', content: [
            { type: 'text', text: userPrompt },
            { type: 'image_url', image_url: { url: imageDataUrl } }
        ]}
    ];
    const resp = await learningFetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: modelName, messages, max_tokens: 2048, temperature: 0.2 }) });
    if (!resp.ok) throw new Error('SiliconFlow Vision request failed');
    const data = await resp.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
}

async function visionTranslateOpenRouter(imageDataUrl) {
    const { openrouterApiKey, openrouterSelectedModel, targetLanguage, secondTargetLanguage } = await chrome.storage.local.get(['openrouterApiKey', 'openrouterSelectedModel', 'targetLanguage', 'secondTargetLanguage']);
    const apiKey = openrouterApiKey; const modelName = openrouterSelectedModel;
    if (!apiKey || !modelName) throw new Error('OpenRouter API or model is not configured');
    const userPrompt = 'Read the text in the attached image.';

    const url = 'https://openrouter.ai/api/v1/chat/completions';
    const messages = [
        { role: 'user', content: [
            { type: 'text', text: userPrompt },
            { type: 'image_url', image_url: { url: imageDataUrl } }
        ]}
    ];
    const resp = await learningFetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://github.com/licon/llm-translate', 'X-Title': 'LLM Translate Extension' }, body: JSON.stringify({ model: modelName, messages, max_tokens: 2048, temperature: 0.2 }) });
    return parseOpenRouterResponse(resp);
}

async function visionTranslateOrcaRouter(imageDataUrl) {
    const { orcarouterApiKey, orcarouterSelectedModel, targetLanguage, secondTargetLanguage } = await chrome.storage.local.get(['orcarouterApiKey', 'orcarouterSelectedModel', 'targetLanguage', 'secondTargetLanguage']);
    if (!orcarouterApiKey || !orcarouterSelectedModel) throw new Error('OrcaRouter API or model is not configured');
    const prompt = 'Read the text in the attached image.';
    return callOrcaRouterChat(orcarouterApiKey, orcarouterSelectedModel, [
        { role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageDataUrl } }
        ] }
    ]);
}

async function visionTranslateOllama(imageDataUrl) {
    const { ollamaUrl, ollamaSelectedModel, targetLanguage, secondTargetLanguage } = await chrome.storage.local.get(['ollamaUrl', 'ollamaSelectedModel', 'targetLanguage', 'secondTargetLanguage']);
    const url = ollamaUrl; const modelName = ollamaSelectedModel;
    if (!url || !modelName) throw new Error('Ollama URL or model is not configured');
    const prompt = 'Read the text in the attached image.';
    // Note: Many Ollama models don't support vision; this is a best-effort text prompt
    const resp = await learningFetch(`${url}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: modelName, prompt, images: [imageDataUrl.split(',')[1]], stream: false }) });
    if (!resp.ok) throw new Error('Ollama Vision request failed');
    const data = await resp.json();
    return data.response?.trim() || '';
}


// --- API call implementations ---

/**
 * Call the Google Gemini API
 */
async function callGeminiAPI(text, apiKey, modelName, targetLanguage, secondTargetLanguage) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const prompt = text;
    
    const response = await learningFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
        }),
    });

    if (!response.ok) {
        const errorBody = await response.json();
        throw new Error(errorBody.error.message || `API request failed`);
    }
    const data = await response.json();
    return data.candidates[0].content.parts[0].text.trim();
}

/**
 * Call the Silicon Flow API (OpenAI-compatible format)
 */
async function callSiliconFlowAPI(text, apiKey, modelName, targetLanguage, secondTargetLanguage) {
    const url = 'https://api.siliconflow.cn/v1/chat/completions';
    const userPrompt = text;

    const response = await learningFetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: modelName,
            messages: [
                { role: 'user', content: userPrompt }
            ],
            max_tokens: 2048,
            temperature: 0.3,
        }),
    });

    if (!response.ok) {
        const errorBody = await response.json();
        throw new Error(errorBody.error.message || `API request failed`);
    }
    const data = await response.json();
    return data.choices[0].message.content.trim();
}

/**
 * Call the OpenRouter API
 */
async function callOpenRouterAPI(text, apiKey, modelName, targetLanguage, secondTargetLanguage) {
    const url = 'https://openrouter.ai/api/v1/chat/completions';
    const userPrompt = text;

    const response = await learningFetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/licon/llm-translate',
            'X-Title': 'LLM Translate Extension',
        },
        body: JSON.stringify({
            model: modelName,
            messages: [
                { role: 'user', content: userPrompt }
            ],
            max_tokens: 2048,
            temperature: 0.3,
        }),
    });

    return parseOpenRouterResponse(response);
}

async function parseOpenRouterResponse(response) {
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.error) {
        const detail = data?.error?.message;
        const hints = {
            401: 'Check your OpenRouter API key in Settings.',
            402: 'Your OpenRouter account has insufficient credits.',
            429: 'OpenRouter rate limit reached. Retry later or configure a backup model.',
        };
        throw new Error(`OpenRouter HTTP ${response.status}: ${detail || hints[response.status] || 'Request failed. Try another model.'}`);
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
        throw new Error('OpenRouter returned no translation. Try another model.');
    }
    return content.trim();
}

async function callOrcaRouterAPI(text, apiKey, modelName, targetLanguage, secondTargetLanguage) {
    const prompt = text;
    return callOrcaRouterChat(apiKey, modelName, [{ role: 'user', content: prompt }]);
}

async function callOrcaRouterChat(apiKey, modelName, messages) {
    const response = await learningFetch('https://api.orcarouter.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName, messages })
    });
    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.error?.message || `OrcaRouter HTTP ${response.status}`);
    }
    const data = await response.json();
    const translation = data.choices?.[0]?.message?.content;
    if (typeof translation !== 'string' || !translation.trim()) {
        throw new Error('OrcaRouter returned an empty translation');
    }
    return translation.trim();
}

/**
 * Call the Ollama API
 */
async function callOllamaAPI(text, ollamaUrl, modelName, targetLanguage, secondTargetLanguage) {
    const url = `${ollamaUrl}/api/generate`;
    const prompt = text;
    
    const response = await learningFetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: modelName,
            prompt: prompt,
            stream: false,
        }),
    });
    
    if (!response.ok) {
        if (response.status === 403) {
            throw new Error('Ollama server rejected the request. Please set the OLLAMA_ORIGINS="*" environment variable and restart the Ollama service.');
        }
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        try {
            const errorBody = await response.text();
            try {
                const errorJson = JSON.parse(errorBody);
                errorMessage = errorJson.error || errorMessage;
            } catch (jsonError) {
                errorMessage = errorBody || errorMessage;
            }
        } catch (textError) {
            // Ignore parsing errors and use the default error message
        }
        throw new Error(errorMessage);
    }
    
    const responseText = await response.text();
    
    if (!responseText.trim()) {
        throw new Error('Ollama returned an empty response. Please check that the model is loaded correctly');
    }
    
    try {
        const data = JSON.parse(responseText);
        if (!data.response) {
            throw new Error('Ollama response format is invalid: missing "response" field');
        }
        return data.response.trim();
    } catch (jsonError) {
        throw new Error(`Failed to parse Ollama response: ${jsonError.message}`);
    }
}
