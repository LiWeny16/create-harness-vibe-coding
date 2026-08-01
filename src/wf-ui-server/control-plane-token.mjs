import crypto from 'node:crypto';
import { validateToken } from './token.mjs';

export function graphReadToken(controlPlaneToken, sessionId) {
  const token = String(controlPlaneToken || '');
  const session = String(sessionId || '');
  if (!token || !session) return '';
  return crypto
    .createHmac('sha256', token)
    .update(`graph-read:${session}`)
    .digest('hex');
}

export function validateGraphReadToken(presentedToken, controlPlaneToken, sessionId) {
  const expected = graphReadToken(controlPlaneToken, sessionId);
  return Boolean(expected) && validateToken(presentedToken, expected);
}
