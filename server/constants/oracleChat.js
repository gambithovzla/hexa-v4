export const ORACLE_CHAT_USER_LABEL = 'Oraclechat';

export function isOracleChatSource(source) {
  return String(source ?? '').toLowerCase() === 'oracle_chat';
}

export function resolveDatasetUserEmail({ pfSource, pickSource, pfUserEmail, pickUserEmail }) {
  if (isOracleChatSource(pfSource) || isOracleChatSource(pickSource)) {
    return ORACLE_CHAT_USER_LABEL;
  }
  return pfUserEmail ?? pickUserEmail ?? null;
}
