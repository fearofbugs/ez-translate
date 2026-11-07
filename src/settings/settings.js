// --- I18n Helper ---
function setupI18n() {
    document.querySelectorAll('[data-i18n]').forEach(elem => {
        const key = elem.getAttribute('data-i18n');
        elem.textContent = chrome.i18n.getMessage(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(elem => {
        const key = elem.getAttribute('data-i18n-placeholder');
        elem.placeholder = chrome.i18n.getMessage(key);
    });
    document.title = chrome.i18n.getMessage('settingsTitle');
}

// --- Language Data ---
const languageKeys = [
    "langEnglish", "langSimplifiedChinese", "langTraditionalChinese", "langFrench", "langSpanish", "langArabic", "langRussian", "langPortuguese", "langGerman", "langItalian", "langDutch", "langDanish", "langIrish", "langWelsh", "langFinnish", "langIcelandic", "langSwedish", "langNorwegianNynorsk", "langNorwegianBokmal", "langJapanese", "langKorean", "langVietnamese", "langThai", "langIndonesian", "langMalay", "langBurmese", "langTagalog", "langKhmer", "langLao", "langHindi", "langBengali", "langUrdu", "langNepali", "langHebrew", "langTurkish", "langPersian", "langPolish", "langUkrainian", "langCzech", "langRomanian", "langBulgarian", "langSlovak", "langHungarian", "langSlovenian", "langLatvian", "langEstonian", "langLithuanian", "langBelarusian", "langGreek", "langCroatian", "langMacedonian", "langMaltese", "langSerbian", "langBosnian", "langGeorgian", "langArmenian", "langNorthAzerbaijani", "langKazakh", "langNorthernUzbek", "langTajik", "langSwahili", "langAfrikaans", "langCantonese", "langLuxembourgish", "langLimburgish", "langCatalan", "langGalician", "langAsturian", "langBasque", "langOccitan", "langVenetian", "langSardinian", "langSicilian", "langFriulian", "langLombard", "langLigurian", "langFaroese", "langToskAlbanian", "langSilesian", "langBashkir", "langTatar", "langMesopotamianArabic", "langNajdiArabic", "langEgyptianArabic", "langLevantineArabic", "langTaizziAdeniArabic", "langDari", "langTunisianArabic", "langMoroccanArabic", "langKabuverdianu", "langTokPisin", "langEasternYiddish", "langSindhi", "langSinhala", "langTelugu", "langPunjabi", "langTamil", "langGujarati", "langMalayalam", "langMarathi", "langKannada", "langMagahi", "langOriya", "langAwadhi", "langMaithili", "langAssamese", "langChhattisgarhi", "langBhojpuri", "langMinangkabau", "langBalinese", "langJavanese", "langBanjar", "langSundanese", "langCebuano", "langPangasinan", "langIloko", "langWarayPhilippines", "langHaitian", "langPapiamento"
];

function populateLanguages() {
    const defaultTargetLanguageSelect = document.getElementById('default-target-language');
    const secondTargetLanguageSelect = document.getElementById('second-target-language');
    
    // Clear existing options
    defaultTargetLanguageSelect.innerHTML = '';
    secondTargetLanguageSelect.innerHTML = '';

    languageKeys.forEach(key => {
        const message = chrome.i18n.getMessage(key);
        
        // Add to default target language select
        const defaultOption = document.createElement('option');
        defaultOption.value = key;
        defaultOption.textContent = message;
        defaultTargetLanguageSelect.appendChild(defaultOption);
        
        // Add to second target language select
        const secondOption = document.createElement('option');
        secondOption.value = key;
        secondOption.textContent = message;
        secondTargetLanguageSelect.appendChild(secondOption);
    });
}

// Language preferences are independent of the model priority list.
document.addEventListener('DOMContentLoaded', async () => {
    setupI18n();
    populateLanguages();
    const status = document.getElementById('status');
    try {
        const values = await chrome.storage.local.get(['targetLanguage', 'secondTargetLanguage']);
        for (const [id, key, fallback] of [
            ['default-target-language', 'targetLanguage', 'langSimplifiedChinese'],
            ['second-target-language', 'secondTargetLanguage', 'langEnglish'],
        ]) {
            const select = document.getElementById(id);
            select.value = values[key] || fallback;
            select.addEventListener('change', async () => {
                try { await chrome.storage.local.set({ [key]: select.value }); status.textContent = 'Language saved'; }
                catch (error) { status.textContent = error.message; }
            });
        }
    } catch (error) { status.textContent = error.message; }
});
