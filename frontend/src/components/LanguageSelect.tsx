import React, { useEffect, useState } from 'react';
import { spellChecker, saveEnabledLanguagePreference } from '../editor/spellchecker';
import { BUNDLED_LANGUAGES } from '../editor/languageCatalog';

const MULTIPLE = '__multiple__';

/** Status-bar picker for the spell-check language. The choice applies to the
 *  whole app. Shows "Multiple languages" if more than one is ticked in the
 *  dictionary settings. */
const LanguageSelect: React.FC = () => {
  const [, setVersion] = useState(0);
  useEffect(() => spellChecker.onChange(() => setVersion((x) => x + 1)), []);

  const enabled = spellChecker.getEnabledLanguages();
  const value = enabled.length === 1 ? enabled[0] : MULTIPLE;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    spellChecker.setEnabledLanguages([e.target.value]);
    saveEnabledLanguagePreference(spellChecker.getEnabledLanguages());
  };

  return (
    <select
      className="status-item status-language"
      value={value}
      onChange={handleChange}
      title="Spell-check language"
      aria-label="Spell-check language"
    >
      {value === MULTIPLE && (
        <option value={MULTIPLE} disabled>Multiple languages</option>
      )}
      {BUNDLED_LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>{l.label}</option>
      ))}
    </select>
  );
};

export default LanguageSelect;
