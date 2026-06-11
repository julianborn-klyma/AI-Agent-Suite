/** Nutzerfreundliche Meldungen — ohne Anthropic/HTTP-Details. */

export function userFacingLlmError(status: number): string {
  if (status === 429 || status === 529) {
    return "Der KI-Dienst ist gerade stark ausgelastet. Bitte warte einen Moment und sende die Nachricht erneut.";
  }
  if (status === 503 || status === 502) {
    return "Der KI-Dienst ist vorübergehend nicht erreichbar. Bitte versuche es in Kürze erneut.";
  }
  return "Die Antwort konnte gerade nicht erstellt werden. Bitte versuche es erneut.";
}

export function isRetryableLlmStatus(status: number): boolean {
  return status === 429 || status === 529 || status === 503 || status === 502;
}
