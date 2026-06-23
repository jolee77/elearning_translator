const AUTH_ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: '이메일 또는 비밀번호가 올바르지 않습니다.',
  email_not_confirmed:
    '이메일 인증이 완료되지 않았습니다. 초대 메일의 링크로 비밀번호를 설정한 뒤 다시 로그인해 주세요.',
  user_banned: '계정이 비활성화되었습니다. 관리자에게 문의해 주세요.',
  over_request_rate_limit: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
}

export function formatAuthError(message: string | null | undefined): string | null {
  if (!message) return null

  const lower = message.toLowerCase()

  if (lower.includes('invalid login credentials')) {
    return AUTH_ERROR_MESSAGES.invalid_credentials
  }
  if (lower.includes('email not confirmed')) {
    return AUTH_ERROR_MESSAGES.email_not_confirmed
  }
  if (lower.includes('user is banned')) {
    return AUTH_ERROR_MESSAGES.user_banned
  }
  if (lower.includes('rate limit')) {
    return AUTH_ERROR_MESSAGES.over_request_rate_limit
  }

  return message
}
