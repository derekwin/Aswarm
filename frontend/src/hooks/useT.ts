import { useCallback } from 'react';
import { useUI } from '@/context/UIContext';
import { messages, type I18NKey } from '@/utils/i18n';

export function useT() {
  const { state } = useUI();
  return useCallback(
    (key: I18NKey): string => {
      return (messages[state.lang] || messages.en)[key] || key;
    },
    [state.lang]
  );
}
