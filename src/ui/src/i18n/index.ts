import { useI18n } from './I18nContext';

export { I18nProvider, useI18n } from './I18nContext';

export function useT() {
  const { t } = useI18n();
  return t;
}
