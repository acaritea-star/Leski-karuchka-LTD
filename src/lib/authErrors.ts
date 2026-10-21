/** PostgREST can briefly reject a newly minted token while server clocks settle.
 * Retrying a profile read never changes JWT validation or grants access locally.
 */
export function isFutureJwtError(error: { message?: string; code?: string } | null | undefined): boolean {
  return !!error && /^JWT issued (?:at|in)(?: the)? future\.?$/i.test(error.message?.trim() ?? '')
    && (!error.code || /^PGRST30[13]$/.test(error.code));
}
export const SESSION_TIMING_ERROR = 'Сесията още не е потвърдена от сървъра. Изчакай няколко секунди и опитай отново. Не е нужно да се регистрираш повторно.';
