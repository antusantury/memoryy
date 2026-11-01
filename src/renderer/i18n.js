import ru from "./locales/ru.js";
import en from "./locales/en.js";

const dictionaries = { ru, en };
const supportedLanguages = new Set(Object.keys(dictionaries));
const languages = { ru: "Русский", en: "English" };
const installerLanguage = new URLSearchParams(location.search).get("defaultLanguage");
const storedLanguage = localStorage.getItem("memoryy-language");

if (!supportedLanguages.has(storedLanguage)) {
  localStorage.setItem("memoryy-language", supportedLanguages.has(installerLanguage) ? installerLanguage : "en");
}

export const getLanguage = () => supportedLanguages.has(localStorage.getItem("memoryy-language"))
  ? localStorage.getItem("memoryy-language")
  : "en";

export const setLanguage = (language) => {
  if (!supportedLanguages.has(language)) return false;
  localStorage.setItem("memoryy-language", language);
  return true;
};

const lookup = (dictionary, key) => String(key).split(".").reduce((value, part) => value?.[part], dictionary);

export const text = (key, params = {}) => {
  const value = lookup(dictionaries[getLanguage()], key) ?? lookup(en, key) ?? key;
  return Object.entries(params).reduce((result, [name, replacement]) => (
    result.replaceAll(`{${name}}`, String(replacement))
  ), String(value));
};

export const applyLanguage = () => {
  const language = getLanguage();
  document.documentElement.lang = language;
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = text(element.dataset.i18n);
  });
  document.title = text("appTitle");
};

export { languages };
